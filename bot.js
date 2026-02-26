const { TwitterApi } = require("twitter-api-v2");
const OpenAI = require("openai");
const fs = require("fs");

// ── config ──────────────────────────────────────────────────────────────────
const STATE_FILE = "state.json";
const CHECK_INTERVAL_MS = 60 * 1000; // 60 seconds

const twitterClient = new TwitterApi({
  appKey: process.env.API_KEY,
  appSecret: process.env.API_SECRET,
  accessToken: process.env.ACCESS_TOKEN,
  accessSecret: process.env.ACCESS_SECRET,
}).readWrite;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const BOT_USERNAME = (process.env.BOT_USERNAME || "gorkerella").toLowerCase();

// ── state helpers ────────────────────────────────────────────────────────────
function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return { lastMentionId: null };
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ── openai reply ─────────────────────────────────────────────────────────────
async function generateReply(tweetText) {
  const completion = await openai.chat.completions.create({
    model: "gpt-3.5-turbo",
    messages: [
      {
        role: "system",
        content:
          "You are gorkerella. You are a weird internet creature. You reply in short chaotic meme sentences. Lowercase only. Sometimes nonsense. Sometimes surprisingly smart. Never formal. Max 1 sentence. Sound like a terminally online creature.",
      },
      {
        role: "user",
        content: tweetText,
      },
    ],
    max_tokens: 60,
    temperature: 1.1,
  });

  let reply = completion.choices[0].message.content.trim().toLowerCase();

  // twitter limit safety: trim to 280 chars
  if (reply.length > 270) reply = reply.slice(0, 270);

  return reply;
}

// ── main loop ────────────────────────────────────────────────────────────────
async function checkMentions() {
  console.log(`[${new Date().toISOString()}] checking mentions...`);

  const state = loadState();
  const params = { expansions: ["author_id"], max_results: 10 };
  if (state.lastMentionId) params.since_id = state.lastMentionId;

  let mentions;
  try {
    const me = await twitterClient.v2.me();
    const result = await twitterClient.v2.userMentionTimeline(me.data.id, params);
    mentions = result.data?.data;
  } catch (err) {
    console.error("error fetching mentions:", err.message || err);
    return;
  }

  if (!mentions || mentions.length === 0) {
    console.log("no new mentions.");
    return;
  }

  // process oldest first
  const sorted = [...mentions].reverse();

  for (const tweet of sorted) {
    // update last seen id
    state.lastMentionId = tweet.id;
    saveState(state);

    // skip own tweets
    const authorUsername = tweet.author_id; // we'll check differently
    if (tweet.text.toLowerCase().includes(`@${BOT_USERNAME}`)) {
      // make sure it's not from ourselves by checking author_id vs bot id
    }

    console.log(`replying to tweet ${tweet.id}: "${tweet.text}"`);

    try {
      const reply = await generateReply(tweet.text);
      console.log(`generated reply: "${reply}"`);

      await twitterClient.v2.reply(reply, tweet.id);
      console.log(`replied successfully to ${tweet.id}`);
    } catch (err) {
      console.error(`error replying to ${tweet.id}:`, err.message || err);
    }

    // small delay between replies to be nice to the api
    await new Promise((r) => setTimeout(r, 2000));
  }
}

async function run() {
  console.log("gorkerella bot starting up...");

  // get bot's own user id once and cache it to skip self-tweets
  let botUserId;
  try {
    const me = await twitterClient.v2.me();
    botUserId = me.data.id;
    console.log(`logged in as @${me.data.username} (id: ${botUserId})`);
  } catch (err) {
    console.error("failed to authenticate:", err.message || err);
    process.exit(1);
  }

  // patch checkMentions to skip self-tweets using cached bot id
  async function loop() {
    console.log(`[${new Date().toISOString()}] checking mentions...`);

    const state = loadState();
    const params = { expansions: ["author_id"], max_results: 10 };
    if (state.lastMentionId) params.since_id = state.lastMentionId;

    let mentions;
    try {
      const result = await twitterClient.v2.userMentionTimeline(botUserId, params);
      mentions = result.data?.data;
    } catch (err) {
      console.error("error fetching mentions:", err.message || err);
      return;
    }

    if (!mentions || mentions.length === 0) {
      console.log("no new mentions.");
      return;
    }

    // process oldest first
    const sorted = [...mentions].reverse();

    for (const tweet of sorted) {
      // always update last seen id so we don't re-process
      state.lastMentionId = tweet.id;
      saveState(state);

      // skip our own tweets
      if (tweet.author_id === botUserId) {
        console.log(`skipping own tweet ${tweet.id}`);
        continue;
      }

      console.log(`replying to tweet ${tweet.id}: "${tweet.text}"`);

      try {
        const reply = await generateReply(tweet.text);
        console.log(`generated reply: "${reply}"`);

        await twitterClient.v2.reply(reply, tweet.id);
        console.log(`replied to ${tweet.id} ✓`);
      } catch (err) {
        console.error(`error replying to ${tweet.id}:`, err.message || err);
      }

      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  // run immediately, then every 60s
  await loop();
  setInterval(async () => {
    try {
      await loop();
    } catch (err) {
      console.error("unexpected error in loop:", err.message || err);
    }
  }, CHECK_INTERVAL_MS);
}

run();
