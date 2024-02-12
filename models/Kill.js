const mongoose = require("mongoose");

const killSchema = new mongoose.Schema(
  {
    characterId: Number,
    characterName: String,
    killmailId: Number,
    killmailTime: Date,
    totalValue: Number,
  },
  { collection: "Kills" }
);

const Kill = mongoose.model("Kill", killSchema);

module.exports = Kill;
