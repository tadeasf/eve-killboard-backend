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
  const killsCollection = db.collection("Kills");
  return killsCollection;
}

const killsCollectionPromise = connectToMongo();

const characters = [
  { id: "1772807647", name: "Tadeas CZ" },
  { id: "2119522407", name: "7oXx" },
  { id: "1296770674", name: "Emnar Thidius" },
  { id: "94370897", name: "Richard Valdyr" },
  { id: "813634421", name: "SanZo Fengi" },
  { id: "135683356", name: "Zeerover" },
  { id: "1902051600", name: "ZeusCommander" },
  { id: "93985921", name: "Vilzuh" },
  { id: "1107376792", name: "snipereagle1" },
  { id: "1787233431", name: "Ice Maniac" },
  { id: "885978821", name: "Bruch Wayne" },
  { id: "1702746983", name: "cegg" },
  { id: "211748991", name: "doombreed52" },
  { id: "2116613377", name: "HelloMeow" },
  { id: "1122768769", name: "Holo Mez" },
  { id: "95859739", name: "Jimmy Oramara" },
  { id: "91412054", name: "K Sully" },
  { id: "91322151", name: "Nokin Niam" },
  { id: "95618389", name: "Phoenix Snow" },
  { id: "1528387696", name: "RawNec" },
  { id: "418281780", name: "Seth Quado" },
  { id: "1181492764", name: "SgtSlacker" },
  { id: "2117414873", name: "Tec8n0" },
  { id: "2120058366", name: "TheRealFatback" },
  { id: "2114249907", name: "Tion Galler" },
  { id: "92663124", name: "Sville Sveltos" },
  { id: "2115781306", name: "Aretha LouiseFrank" },
  { id: "2113791254", name: "Cleanthes" },
  { id: "2112599464", name: "Mad Dawg Yaken" },
  { id: "1451471232", name: "mr bowjangles" },
  { id: "2116105023", name: "Drithi Moonshae" },
  { id: "2120186660", name: "ozzy993" },
  { id: "134063007", name: "Yamcha7" },
  { id: "93426904", name: "John Cravius" },
  { id: "91613448", name: "Private Panacan" },
  { id: "1135028350", name: "Arkady Drayson" },
  { id: "93466458", name: "Malcolm Bobodiablo" },
  { id: "91290222", name: "tainted demon" },
  { id: "345875676", name: "Caleb Drakka" },
];

async function fetchAndStoreKillData() {
  try {
    const killsCollection = await killsCollectionPromise;
    console.log("Fetching kill data");
    // Determine the start of the current week (Sunday as the start)
    const now = new Date();
    const firstDayOfWeek = new Date(now.setDate(now.getDate() - now.getDay()));
    firstDayOfWeek.setHours(0, 0, 0, 0); // Set to the start of the day

    for (const character of characters) {
      const zKillUrl = `https://zkillboard.com/api/kills/characterID/${character.id}/`;
      const zKillResponse = await axios.get(zKillUrl);

      for (const kill of zKillResponse.data) {
        const esiUrl = `https://esi.evetech.net/latest/killmails/${kill.killmail_id}/${kill.zkb.hash}/`;
        const esiResponse = await axios.get(esiUrl);
        const killTime = new Date(esiResponse.data.killmail_time);

        // Check if killmail is within the current week
        if (killTime >= firstDayOfWeek) {
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

// Immediately fetch kills on server start and schedule to run every 20 minutes
fetchAndStoreKillData().catch(console.error);
// Schedule to fetch kills data every 20 minutes
cron.schedule("*/20 * * * *", () => {
  fetchAndStoreKillData().catch(console.error);
});

app.get("/", (req, res) => {
  res.send("EVE Online Kill Tracker Running");
});

app.get("/api/weekly-summary", async (req, res) => {
  try {
    const killsCollection = await killsCollectionPromise;
    // Now you can use killsCollection for aggregation directly without connecting again
    // Calculate the start and end of the current week
    const now = new Date();
    const startOfWeek = new Date(now.setDate(now.getDate() - now.getDay()));
    startOfWeek.setHours(0, 0, 0, 0); // Start of the week
    const endOfWeek = new Date(now.setDate(now.getDate() - now.getDay() + 6));
    endOfWeek.setHours(23, 59, 59, 999); // End of the week

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

app.listen(port, () => console.log(`Server running on port ${port}`));
