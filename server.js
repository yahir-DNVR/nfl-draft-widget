const express = require("express");
const WebSocket = require("ws");

const app = express();
const PORT = process.env.PORT || 3000;

const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

const wss = new WebSocket.Server({ server });

let lastPayload = null;

function broadcast(data) {
  const message = JSON.stringify(data);

  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

function broadcastIfChanged(data) {
  const next = JSON.stringify(data);
  const prev = lastPayload ? JSON.stringify(lastPayload) : null;

  if (next !== prev) {
    lastPayload = data;
    console.log("LIVE UPDATE:", data);
    broadcast(data);
  }
}

const DRAFT_URL = "https://site.api.espn.com/apis/v2/sports/football/nfl/draft";

function getAllPicks(data) {
  if (!data?.draft?.rounds) return [];

  const allPicks = [];

  for (const round of data.draft.rounds) {
    if (Array.isArray(round.picks)) {
      allPicks.push(...round.picks);
    }
  }

  return allPicks;
}

function normalizeStatus(rawStatus) {
  const s = String(rawStatus || "").toLowerCase();

  if (s.includes("on")) return "onClock";
  if (s.includes("pick") || s.includes("selection")) return "picked";

  return null;
}

function findLivePick(data) {
  const allPicks = getAllPicks(data);

  console.log("Total picks found:", allPicks.length);

  if (!allPicks.length) return null;

  for (const pick of allPicks) {
    const rawStatus =
      pick?.status?.type?.name ||
      pick?.status?.name ||
      pick?.pickStatus ||
      "";

    const team = pick?.team?.displayName || "Unknown Team";

    console.log("Pick check:", team, rawStatus);

    if (normalizeStatus(rawStatus) === "onClock") {
      return {
        team,
        status: "onClock"
      };
    }
  }

  const latestPick = allPicks[allPicks.length - 1];

  if (latestPick) {
    const rawStatus =
      latestPick?.status?.type?.name ||
      latestPick?.status?.name ||
      latestPick?.pickStatus ||
      "";

    return {
      team: latestPick?.team?.displayName || "Denver Broncos",
      status: normalizeStatus(rawStatus) || "picked"
    };
  }

  return null;
}

async function checkDraft() {
  try {
    const res = await fetch(DRAFT_URL, {
      headers: {
        "User-Agent": "Mozilla/5.0"
      }
    });

    const data = await res.json();
    console.log("Draft data received");

    const livePick = findLivePick(data);
    console.log("Live pick found:", livePick);

    if (!livePick) return;

    broadcastIfChanged(livePick);
  } catch (err) {
    console.error("Draft fetch error:", err.message);
  }
}

wss.on("connection", (ws) => {
  if (lastPayload) {
    ws.send(JSON.stringify(lastPayload));
  } else {
    ws.send(JSON.stringify({
      team: "Denver Broncos",
      status: "onClock"
    }));
  }
});

checkDraft();
setInterval(checkDraft, 5000);

app.use(express.static("public"));
