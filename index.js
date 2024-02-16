const express = require("express");
const { MongoClient } = require("mongodb");
const cron = require("node-cron");
const axios = require("axios");
const cors = require("cors");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 38978;
const mongoUri = process.env.MONGO_URI;

app.use(cors({ origin: "*" }));

const client = new MongoClient(mongoUri);

async function connectToMongo() {
  await client.connect();
  console.log("Connected to MongoDB");
  const db = client.db("eve-killboard");
  return db;
}

const dbPromise = connectToMongo();

// ! RÁN killboard core

async function fetchCharacters() {
  const db = await dbPromise;
  const charactersCollection = db.collection("characters");
  return charactersCollection.find({}).toArray();
}

async function fetchWithRetry(url, retries = 3, delay = 10000) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await axios.get(url);
      return response.data;
    } catch (error) {
      if (i === retries - 1) throw error;
      console.log(`Request failed, retrying (${i + 1}/${retries})...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

async function fetchAndStoreKillData() {
  try {
    const db = await dbPromise;
    const killsCollection = db.collection("Kills");
    const characters = await fetchCharacters();

    console.log("Fetching kill data");

    const now = new Date();
    const dayOfWeek = now.getDay();
    const firstDayOfWeek = new Date(
      now.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1))
    );
    firstDayOfWeek.setHours(0, 0, 0, 0);

    for (const character of characters) {
      const zKillUrl = `https://zkillboard.com/api/kills/characterID/${character.id}/`;
      const zKillResponse = await fetchWithRetry(zKillUrl);

      for (const kill of zKillResponse) {
        const esiUrl = `https://esi.evetech.net/latest/killmails/${kill.killmail_id}/${kill.zkb.hash}/`;
        const esiResponse = await fetchWithRetry(esiUrl);
        const killTime = new Date(esiResponse.killmail_time);

        if (killTime >= firstDayOfWeek) {
          const solarSystemUrl = `https://esi.evetech.net/latest/universe/systems/${esiResponse.solar_system_id}/`;
          const solarSystemResponse = await fetchWithRetry(solarSystemUrl);

          const constellationUrl = `https://esi.evetech.net/latest/universe/constellations/${solarSystemResponse.constellation_id}/`;
          const constellationResponse = await fetchWithRetry(constellationUrl);

          const regionUrl = `https://esi.evetech.net/latest/universe/regions/${constellationResponse.region_id}/`;
          const regionResponse = await fetchWithRetry(regionUrl);

          const existingKill = await killsCollection.findOne({
            killmailId: kill.killmail_id,
            characterId: character.id,
          });

          if (!existingKill) {
            await killsCollection.insertOne({
              characterId: character.id,
              characterName: character.name,
              killmailId: kill.killmail_id,
              killmailTime: killTime,
              totalValue: kill.zkb.totalValue,
              solarSystemName: solarSystemResponse.name,
              constellationId: solarSystemResponse.constellation_id,
              regionId: constellationResponse.region_id,
              regionName: regionResponse.name,
            });
          }
        }
      }
    }
    console.log("Kill data fetched and stored");
  } catch (error) {
    console.error("Error during fetching and storing kill data:", error);
  }
}

// fetchAndStoreKillData().catch(console.error);

cron.schedule("*/20 * * * *", () => {
  fetchAndStoreKillData().catch(console.error);
});

app.get("/", (req, res) => {
  res.send("EVE Online Kill Tracker Running");
});

app.get("/api/weekly-summary", async (req, res) => {
  try {
    const killsCollection = await killsCollectionPromise;
    const now = new Date();
    const startOfWeek = new Date(now.setDate(now.getDate() - now.getDay()));
    startOfWeek.setHours(0, 0, 0, 0);
    const endOfWeek = new Date(now.setDate(now.getDate() - now.getDay() + 6));
    endOfWeek.setHours(23, 59, 59, 999);

    const aggregation = [
      {
        $match: {
          killmailTime: {
            $gte: startOfWeek,
            $lte: endOfWeek,
          },
        },
      },
      {
        $match: {
          regionName: {
            $in: ["Placid", "Syndicate", "Outer Ring", "Blackrise", "Essence"],
          },
        },
      },
      {
        $group: {
          _id: "$characterName",
          killCount: { $sum: 1 },
          totalValue: { $sum: "$totalValue" },
        },
      },
      {
        $sort: {
          totalValue: -1,
        },
      },
      {
        $project: {
          _id: 0,
          characterName: "$_id",
          killCount: 1,
          totalValue: 1,
        },
      },
    ];

    const weeklySummary = await killsCollection
      .aggregate(aggregation)
      .toArray();
    res.json(weeklySummary);
  } catch (error) {
    console.error("Error fetching weekly summary:", error);
    res.status(500).send("Internal Server Error");
  }
});

// ! price fetching
async function updatePrices() {
  const db = await dbPromise;
  const collection = db.collection("Prices");

  const count = await collection.countDocuments();
  if (count > 0) {
    await collection.deleteMany({});
  }

  const response = await axios.get(
    "https://esi.evetech.net/latest/markets/prices/?datasource=tranquility"
  );
  const pricesData = response.data.map((item) => ({
    ...item,
    last_updated: new Date(),
  }));

  await collection.insertMany(pricesData);
  console.log("Prices collection updated.");
}

cron.schedule("0 0 * * *", () => {
  console.log("Running a task every 24 hours to update prices");
  updatePrices().catch(console.error);
});

app.get("/api/update-prices", async (req, res) => {
  await updatePrices();
  res.send("Prices collection has been updated.");
});

app.get("/api/average-price/:type_id", async (req, res) => {
  try {
    const db = await dbPromise;
    const collection = db.collection("Prices");
    const typeId = parseInt(req.params.type_id);

    if (isNaN(typeId)) {
      return res.status(400).send("Invalid type_id provided.");
    }

    const priceDocument = await collection.findOne({ type_id: typeId });

    if (!priceDocument) {
      return res.status(404).send("Document for the given type_id not found.");
    }

    res.json({
      type_id: typeId,
      average_price: priceDocument.average_price,
      last_updated: priceDocument.last_updated,
    });
  } catch (error) {
    console.error("Error fetching average price:", error);
    res.status(500).send("Internal Server Error");
  }
});

// ! drop checking logic

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Fetch kill data for a specific system from zKillboard
async function fetchKillDataForSystem(systemId) {
  const zKillUrl = `https://zkillboard.com/api/kills/systemID/${systemId}/`;
  try {
    const response = await axios.get(zKillUrl);
    return response.data[0]; // Return only the first kill
  } catch (error) {
    console.error(
      `Failed to fetch kill data for system ID ${systemId}:`,
      error
    );
    throw error;
  }
}

async function processFirstKillForSystem(systemId, db) {
  try {
    const firstKill = await fetchKillDataForSystem(systemId);
    if (firstKill) {
      const existingKill = await db
        .collection("killsBlops")
        .findOne({ killmail_id: firstKill.killmail_id });
      if (existingKill) {
        console.log(
          `Killmail ID ${firstKill.killmail_id} already processed for system ${systemId}.`
        );
        return; // Skip if killmail already processed
      }
      await processKillmail(firstKill, db);
    }
  } catch (error) {
    console.error(`Error processing first kill for system ${systemId}:`, error);
  }
}

async function processKillmail(kill, db) {
  const esiUrl = `https://esi.evetech.net/latest/killmails/${kill.killmail_id}/${kill.zkb.hash}/`;
  const response = await axios.get(esiUrl);
  const killData = response.data;

  const attackersWithPriceCheck = await Promise.all(
    killData.attackers.map(async (attacker) => {
      const priceInfo = await db
        .collection("Prices")
        .findOne({ type_id: attacker.ship_type_id });
      return priceInfo && priceInfo.average_price > 500000000 ? attacker : null;
    })
  );

  const expensiveAttackers = attackersWithPriceCheck.filter(
    (attacker) => attacker !== null
  );
  if (expensiveAttackers.length > 0) {
    await db.collection("killsBlops").insertOne({
      killmail_id: kill.killmail_id,
      killmail_time: killData.killmail_time,
      solar_system_id: killData.solar_system_id,
      victim: killData.victim,
      attackers: killData.attackers,
    });
    console.log(
      `Stored killmail ID ${kill.killmail_id} in killsBlops collection.`
    );
  }
}

// Main endpoint to initiate kill data processing with rate limiting
app.get("/api/process-kills", async (req, res) => {
  const db = await dbPromise;
  const systems = await db.collection("systems").find({}).toArray();

  // Throttle requests to zKillboard to 1 request per second
  for (const system of systems) {
    await processFirstKillForSystem(system.id, db);
    await delay(1000); // Wait for 1 second before processing the next system
  }

  res.send("Completed processing the first kill for all systems.");
});

// Fetch ship name from ESI
async function fetchShipName(shipTypeId) {
  try {
    const url = `https://esi.evetech.net/latest/universe/types/${shipTypeId}/?datasource=tranquility&language=en`;
    const response = await axios.get(url);
    return response.data.name;
  } catch (error) {
    console.error(
      `Failed to fetch ship name for type ID ${shipTypeId}:`,
      error
    );
    throw error;
  }
}

// Fetch system name from MongoDB
async function fetchSystemName(systemId, db) {
  try {
    const system = await db.collection("systems").findOne({ id: systemId });
    return system ? system.name : "Unknown";
  } catch (error) {
    console.error(`Failed to fetch system name for ID ${systemId}:`, error);
    throw error;
  }
}

// Fetch average price for a ship type
async function fetchAveragePrice(shipTypeId, db) {
  try {
    const priceInfo = await db
      .collection("Prices")
      .findOne({ type_id: shipTypeId });
    return priceInfo ? priceInfo.average_price : null;
  } catch (error) {
    console.error(
      `Failed to fetch average price for ship type ID ${shipTypeId}:`,
      error
    );
    throw error;
  }
}

app.get("/api/recent-kills", async (req, res) => {
  try {
    const db = await dbPromise;
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

    const recentKills = await db
      .collection("killsBlops")
      .find({ killmail_time: { $gte: fiveMinutesAgo.toISOString() } })
      .toArray();

    const killsData = await Promise.all(
      recentKills.map(async (kill) => {
        const attackerShips = await Promise.all(
          kill.attackers.map(async (attacker) => ({
            name: await fetchShipName(attacker.ship_type_id),
            value: await fetchAveragePrice(attacker.ship_type_id, db),
          }))
        );

        return {
          killmail_time: kill.killmail_time,
          attacker_ships: attackerShips,
          system: await fetchSystemName(kill.solar_system_id, db),
          zkill_url: `https://zkillboard.com/kill/${kill.killmail_id}/`,
        };
      })
    );

    res.json(killsData);
  } catch (error) {
    console.error("Error fetching recent kills:", error);
    res.status(500).send("Internal Server Error");
  }
});

app.listen(port, () => console.log(`Server running on port ${port}`));
