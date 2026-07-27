// Resets a user's password from the terminal — for when "Forgot password?"
// isn't an option (no email on file, or SMTP isn't configured yet).
// Run with `npm run reset-password`.
const readline = require("readline");
const db = require("../db");
const { hashPassword } = require("../auth");

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const lines = rl[Symbol.asyncIterator]();
async function ask(question) {
  process.stdout.write(question);
  const { value, done } = await lines.next();
  return done ? "" : value;
}

async function main() {
  const username = (await ask("Username to reset: ")).trim();
  const user = db.getUserByUsername(username);
  if (!user) {
    console.log(`No user named "${username}".`);
    process.exit(1);
  }

  const password = await ask("New password (min 6 characters): ");
  if (password.length < 6) {
    console.log("Password must be at least 6 characters.");
    process.exit(1);
  }
  const confirm = await ask("Confirm new password: ");
  if (password !== confirm) {
    console.log("Passwords didn't match.");
    process.exit(1);
  }
  rl.close();

  db.setPassword(user.id, hashPassword(password));
  db.clearResetToken(user.id);

  console.log(`\nPassword updated for "${user.username}". You can log in at /login now.`);
}

main();
