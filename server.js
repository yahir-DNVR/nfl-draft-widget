const express = require("express");
const WebSocket = require("ws");

const app = express();
const PORT = process.env.PORT || 3000;
const YEAR = 2026;

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

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0"
    }
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for ${url}`);
  }

  return res.json();
}

function normalizeStatus(rawStatus) {
  const s = String(rawStatus || "").toLowerCase();

  if (s.includes("on")) return "onClock";
  if (s.includes("pick") || s.includes("selection")) return "picked";

  return null;
}

function teamNameFromRef(refObj) {
  return (
    refObj?.team?.displayName ||
    refObj?.team?.shortDisplayName ||
    refObj?.displayName ||
    refObj?.shortDisplayName ||
    null
  );
}

async function findLivePick() {
  const roundsUrl = `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/${YEAR}/draft/rounds`;
  const statusUrl = `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/${YEAR}/draft/status`;

  const [roundsData, statusData] = await Promise.all([
    fetchJson(roundsUrl),
    fetchJson(statusUrl)
  ]);

  console.log("Draft rounds received");
  console.log("Draft status received:", statusData);

  const currentRound =
    statusData?.currentRound ||
    statusData?.round ||
    1;

  const currentPick =
    statusData?.currentPick ||
    statusData?.pick ||
    statusData?.selection ||
    1;

  console.log("Current round:", currentRound, "Current pick:", currentPick);

  const rounds = roundsData?.items || roundsData?.rounds || [];
  if (!Array.isArray(rounds) || !rounds.length) {
    console.log("No rounds found");
    return null;
  }

  // Try to find the round object matching currentRound
  let roundRef = null;

  for (const r of rounds) {
    if ((r?.number || r?.round) === currentRound) {
      roundRef = r;
      break;
    }
  }

  // If the round list is refs only, dereference them until we find the right round
  if (!roundRef) {
    for (const r of rounds) {
      if (r?.$ref) {
        const fullRound = await fetchJson(r.$ref);
        if ((fullRound?.number || fullRound?.round) === currentRound) {
          roundRef = fullRound;
          break;
        }
      }
    }
  } else if (roundRef?.$ref) {
    roundRef = await fetchJson(roundRef.$ref);
  }

  if (!roundRef) {
    console.log("No matching round found");
    return null;
  }

  const picks = roundRef?.picks?.items || roundRef?.picks || [];
  console.log("Picks in round:", picks.length);

  // Try exact current pick first
  for (const p of picks) {
    const pickObj = p?.$ref ? await fetchJson(p.$ref) : p;
    const pickNumber = pickObj?.number || pickObj?.pick || pickObj?.selection;

    if (pickNumber === currentPick) {
      const rawStatus =
        pickObj?.status?.type?.name ||
        pickObj?.status?.name ||
        statusData?.type?.name ||
        statusData?.name ||
        "";

      const team =
        pickObj?.team?.displayName ||
        teamNameFromRef(pickObj) ||
        "Denver Broncos";

      return {
        team,
        status: normalizeStatus(rawStatus) || "onClock"
      };
    }
  }

  // Fallback: first pick marked on clock
  for (const p of picks) {
    const pickObj = p?.$ref ? await fetchJson(p.$ref) : p;
    const rawStatus =
      pickObj?.status?.type?.name ||
      pickObj?.status?.name ||
      "";

    const norm = normalizeStatus(rawStatus);
    if (norm === "onClock") {
      const team =
        pickObj?.team?.displayName ||
        teamNameFromRef(pickObj) ||
        "Denver Broncos";

      return {
        team,
        status: "onClock"
      };
    }
  }

  return null;
}

async function checkDraft() {
  try {
    const livePick = await findLivePick();
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
