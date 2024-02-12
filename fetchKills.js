require("dotenv").config();
const axios = require("axios");
const mongoose = require("mongoose");
const Kill = require("./models/Kill"); // Adjust the path as necessary

mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
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
  const currentWeek = new Date();
  currentWeek.setDate(
    currentWeek.getDate() -
      currentWeek.getDay() +
      (currentWeek.getDay() === 0 ? -6 : 1)
  );

  for (const character of characters) {
    const zKillUrl = `https://zkillboard.com/api/kills/characterID/${character.id}/`;
    try {
      const zKillResponse = await axios.get(zKillUrl);
      for (const kill of zKillResponse.data) {
        const esiUrl = `https://esi.evetech.net/latest/killmails/${kill.killmail_id}/${kill.zkb.hash}/`;
        const esiResponse = await axios.get(esiUrl);
        if (new Date(esiResponse.data.killmail_time) >= currentWeek) {
          const existingKill = await Kill.findOne({
            killmailId: kill.killmail_id,
            characterId: character.id,
          });
          if (!existingKill) {
            await Kill.create({
              characterId: character.id,
              characterName: character.name,
              killmailId: kill.killmail_id,
              killmailTime: esiResponse.data.killmail_time,
              totalValue: kill.zkb.totalValue,
            });
          }
        }
      }
    } catch (error) {
      console.error(`Error fetching kills for ${character.name}:`, error);
    }
  }
};

// Schedule to run every 20 minutes
const cron = require("node-cron");
cron.schedule("*/20 * * * *", fetchAndStoreKillData);
