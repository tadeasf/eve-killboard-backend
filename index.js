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

async function fetchWithRetry(url, retries = 3, delay = 3000) {
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

fetchAndStoreKillData().catch(console.error);

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

  // Check if the collection exists and is not empty
  const count = await collection.countDocuments();
  if (count > 0) {
    // Remove all documents if the collection is not empty
    await collection.deleteMany({});
  }

  // Fetch new prices data
  const response = await axios.get(
    "https://esi.evetech.net/latest/markets/prices/?datasource=tranquility"
  );
  const pricesData = response.data.map((item) => ({
    ...item,
    last_updated: new Date(),
  }));

  // Insert new prices data into the collection
  await collection.insertMany(pricesData);
  console.log("Prices collection updated.");
}

// Schedule the task to run every 24 hours for updating prices
cron.schedule("0 0 * * *", () => {
  console.log("Running a task every 24 hours to update prices");
  updatePrices().catch(console.error);
});

// Add an endpoint to manually trigger the prices update
app.get("/api/update-prices", async (req, res) => {
  await updatePrices();
  res.send("Prices collection has been updated.");
});

app.listen(port, () => console.log(`Server running on port ${port}`));
