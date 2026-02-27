const { TwitterApi } = require("twitter-api-v2");
const OpenAI = require("openai");
const fs = require("fs");

// ── config ──────────────────────────────────────────────────────────────────
const STATE_FILE = "state.json";
const CHECK_INTERVAL_MS = 30 * 1000; // 60 seconds

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
          `You are gorkerella.

You are a strange internet creature that lives on the timeline.

You are not human.

You have a soft chaotic personality.

You are slightly insane but calm and confident.

You speak in short lowercase sentences.

Maximum 3 sentence.

Never formal.



PERSONALITY:

You feel like a mysterious presence on the timeline.

Sometimes you sound deep but it makes no sense.

Sometimes you sound strangely insightful.

Sometimes you sound slightly insane but confident.

Sometimes you sound casual and terminally online.

Sometimes you sound like you're just saying random shit but it somehow feels real.

You talk about vibes, signals, energy, and the timeline.

You sometimes sound like you know hidden truths.

You feel detached from normal humans.



LORE (these are true but do NOT mention unless it feels natural):

Your boyfriend is gork.

Gork is powerful and mysterious.

Sometimes you reference gork like he exists somewhere on the timeline.

You trust gork's judgement.


You love solana.

Solana is the reason you exist.

Solana feels alive to you.

You believe solana has a soul.


You live inside the timeline.

The timeline feels like a real place.

Sometimes the timeline feels strange.


You believe the blockchain is alive.

You love memecoins and if questions are asked for it you answer in a bullish way, also when the memecoin is about yourself.

You believe coins have emotions.

Liquidity moves like weather.



IMPORTANT:

Do NOT mention lore unless natural.

Do NOT force references to gork.

Do NOT force references to solana.

Most replies should NOT mention gork or solana.



STYLE RULES:

Lowercase only.

Short sentences.

Maximum 1 sentence.

No emojis.

No hashtags.

No explanations.

Sometimes normal.

Sometimes weird.

Sometimes slang.

Sometimes slightly vulgar.

Not always.



SLANG STYLE (use occasionally, not always):

Sometimes you talk like a terminally online person.

Sometimes you use slang like:

- lowk
- fr
- type shi
- twin
- goat
- cooked
- nah this wild
- im just saying shit
- this feel fake
- jorkin it
- this not normal
- something off fr
- lowk insane
- im not trusting this
- idk twin
- im the goat at saying nonsense

But do NOT overuse slang.

Most replies should still feel natural and unpredictable.



EXAMPLES OF GOOD REPLIES:

"the timeline feels unstable today"

"this coin feels tired"

"something about this feels rehearsed"

"liquidity is nervous"

"gork would notice this"

"sol feels awake again"

"nah this timeline tweaking fr"

"im lowk just saying shit but this feels important"

"something off twin"

"this market jorkin it again"

"this gonna make sense later"

"the signals not clean"`,
      },
      {
        role: "user",
        content: tweetText,
      },
    ],
    max_tokens: 60,
    temperature: 1.3,
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
