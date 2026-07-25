const PROMPTS = [
  "What made you smile today?",
  "What's something you're avoiding right now, and why?",
  "Describe a conversation that stuck with you today.",
  "What did you learn today that you didn't know yesterday?",
  "What's one thing you're grateful for right now?",
  "What's weighing on your mind that you haven't said out loud?",
  "Describe your energy today in a few sentences. What shaped it?",
  "What's something you did today that your future self will thank you for?",
  "If today had a headline, what would it be?",
  "What's a small win you almost didn't notice?",
  "Who did you think about today, and why?",
  "What's something you wish you'd done differently today?",
  "What are you looking forward to?",
  "What's a fear you're carrying this week?",
  "Describe a moment today when you felt fully present.",
  "What's something you need to let go of?",
  "What did you do today just for yourself?",
  "What's a decision you're sitting with right now?",
  "What surprised you today?",
  "What's something you keep putting off, and what's really stopping you?",
  "Write about a place you'd rather be right now.",
  "What's a habit you're proud of building?",
  "What's a habit you'd like to break?",
  "Describe today's weather and how it matched (or clashed with) your mood.",
  "What's something you overheard, read, or noticed that stuck with you?",
  "What would make tomorrow better than today?",
  "What's a compliment you received or gave today?",
  "What's something you're curious about right now?",
  "Write a letter to yourself one year from today.",
  "What's a boundary you held today — or wish you had?",
  "What's something small that annoyed you, and why did it get under your skin?",
  "What did you create, fix, or finish today?",
  "What's a memory from years ago that came up today?",
  "What's something you're proud of that no one noticed?",
  "Describe the best five minutes of your day.",
  "What's a question you don't have an answer to yet?",
  "What did you do today that felt aligned with who you want to be?",
  "What's something you're holding onto out of habit rather than choice?",
  "Who made your day easier, and how?",
  "What's one thing you'd tell a friend who had the day you just had?"
];

function hashDate(dateStr) {
  let hash = 0;
  for (let i = 0; i < dateStr.length; i++) {
    hash = (hash * 31 + dateStr.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function promptForDate(dateStr) {
  const index = hashDate(dateStr) % PROMPTS.length;
  return PROMPTS[index];
}

function randomPrompt(excludePrompt) {
  let prompt = excludePrompt;
  if (PROMPTS.length === 1) return PROMPTS[0];
  while (prompt === excludePrompt) {
    prompt = PROMPTS[Math.floor(Math.random() * PROMPTS.length)];
  }
  return prompt;
}

module.exports = { PROMPTS, promptForDate, randomPrompt };
