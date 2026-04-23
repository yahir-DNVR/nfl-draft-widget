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

let controlState = {
  mode: "auto", // "auto" or "manual"
  team: "Las Vegas Raiders",
  status: "onClock"
};

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

async function findLivePick() {
  const roundsUrl = `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/${YEAR}/draft/rounds`;
  const statusUrl = `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/${YEAR}/draft/status`;

  const [roundsData, statusData] = await Promise.all([
    fetchJson(roundsUrl),
    fetchJson(statusUrl)
  ]);

  const statusName = String(statusData?.type?.name || "").toUpperCase();
  const statusState = String(statusData?.type?.state || "").toLowerCase();

  if (statusName === "SCHEDULED" || statusState === "pre") {
    return {
      team: "Las Vegas Raiders",
      status: "onClock"
    };
  }

  const currentRound =
    statusData?.currentRound ||
    statusData?.round ||
    1;

  const currentPick =
    statusData?.currentPick ||
    statusData?.pick ||
    statusData?.selection ||
    1;

  const rounds = roundsData?.items || roundsData?.rounds || [];
  if (!Array.isArray(rounds) || !rounds.length) {
    return null;
  }

  let roundRef = null;

  for (const r of rounds) {
    if ((r?.number || r?.round) === currentRound) {
      roundRef = r;
      break;
    }
  }

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
    return null;
  }

  const picks = roundRef?.picks?.items || roundRef?.picks || [];

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
        pickObj?.team?.shortDisplayName ||
        "Las Vegas Raiders";

      return {
        team,
        status: normalizeStatus(rawStatus) || "onClock"
      };
    }
  }

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
        pickObj?.team?.shortDisplayName ||
        "Las Vegas Raiders";

      return {
        team,
        status: "onClock"
      };
    }
  }

  return {
    team: "Las Vegas Raiders",
    status: "onClock"
  };
}

async function checkDraft() {
  try {
    if (controlState.mode === "manual") {
      broadcastIfChanged({
        team: controlState.team,
        status: controlState.status
      });
      return;
    }

    const livePick = await findLivePick();
    if (!livePick) return;

    broadcastIfChanged(livePick);
  } catch (err) {
    console.error("Draft fetch error:", err.message);
  }
}

app.use(express.json());
app.use(express.static("public"));

app.get("/api/control", (req, res) => {
  res.json(controlState);
});

app.post("/api/control/manual", (req, res) => {
  const { team, status } = req.body || {};

  if (!team || !status) {
    return res.status(400).json({ error: "team and status are required" });
  }

  controlState = {
    mode: "manual",
    team,
    status
  };

  broadcastIfChanged({
    team: controlState.team,
    status: controlState.status
  });

  res.json({ ok: true, controlState });
});

app.post("/api/control/auto", async (req, res) => {
  controlState.mode = "auto";

  await checkDraft();

  res.json({ ok: true, controlState });
});

wss.on("connection", (ws) => {
  const initialPayload =
    controlState.mode === "manual"
      ? { team: controlState.team, status: controlState.status }
      : lastPayload || { team: "Las Vegas Raiders", status: "onClock" };

  ws.send(JSON.stringify(initialPayload));
});

checkDraft();
setInterval(checkDraft, 5000);
