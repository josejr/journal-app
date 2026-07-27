// One-time bootstrap: creates the first (admin) account and attaches any
// pre-multiuser journal data to it. Run with `npm run create-admin`.
// Further accounts are created from the Admin page in the app.
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
  if (db.countUsers() > 0) {
    console.log("An account already exists. Use the Admin page in the app to add more users.");
    process.exit(1);
  }

  const username = (await ask("Choose a username: ")).trim();
  if (!username) {
    console.log("Username can't be empty.");
    process.exit(1);
  }

  const email = (await ask("Email (optional, needed for \"Forgot password?\"): ")).trim();
  if (email && db.getUserByEmail(email)) {
    console.log(`"${email}" is already in use.`);
    process.exit(1);
  }

  const password = await ask("Choose a password (min 6 characters): ");
  if (password.length < 6) {
    console.log("Password must be at least 6 characters.");
    process.exit(1);
  }
  const confirm = await ask("Confirm password: ");
  if (password !== confirm) {
    console.log("Passwords didn't match.");
    process.exit(1);
  }
  rl.close();

  const user = db.createUser({ username, email, password_hash: hashPassword(password), is_admin: true });
  const migrated = db.migrateLegacyData(user.id);

  console.log(`\nCreated admin account "${user.username}".`);
  if (migrated.entries || migrated.goals || migrated.settings) {
    console.log(
      `Attached existing data: ${migrated.entries} entr${migrated.entries === 1 ? "y" : "ies"}, ` +
        `${migrated.goals} goal${migrated.goals === 1 ? "" : "s"}` +
        `${migrated.settings ? ", and prior reminder/Telegram settings" : ""}.`
    );
  }
  console.log("You can now log in at /login.");
}

main();
