const express = require("express");
const { MongoClient } = require("mongodb");
const cron = require("node-cron");
const axios = require("axios");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 38978;
const mongoUri = process.env.MONGO_URI;

const client = new MongoClient(mongoUri);
let db;
let killsCollection;

// Connect to MongoDB when the application starts
client
  .connect()
  .then(() => {
    console.log("Connected to MongoDB");
    db = client.db("eve-killboard");
    killsCollection = db.collection("Kills");
  })
  .catch((error) => {
    console.error("Failed to connect to MongoDB", error);
    process.exit(1);
  });
const characters = [
  { id: "1772807647", name: "Tadeas CZ" },
  { id: "2114774296", name: "Cengar Creire-Geng" },
  { id: "2116810440", name: "Deathly Hallows2" },
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
];

const fetchAndStoreKillData = async () => {
  try {
    await client.connect();
    const db = client.db("eve-killboard");
    const killsCollection = db.collection("Kills");
    console.log("fetching kill data");

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
  } catch (error) {
    console.error("Error during fetching and storing kill data:", error);
  } finally {
    await client.close();
  }
};

// Immediately fetch kills on server start and schedule to run every 20 minutes
fetchAndStoreKillData().catch(console.error);
cron.schedule("*/20 * * * *", () => {
  fetchAndStoreKillData().catch(console.error);
});

app.get("/", (req, res) => {
  res.send("EVE Online Kill Tracker Running");
});

app.get("/api/weekly-summary", async (req, res) => {
  try {
    // Ensure the MongoDB client is connected
    if (!db || !killsCollection) {
      throw new Error("MongoDB client is not connected");
    }

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
