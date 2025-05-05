const express = require("express");
const bodyParser = require("body-parser");
const sqlite3 = require("sqlite3").verbose();
const jwt = require("jsonwebtoken");
const path = require("path");

const app = express();
const port = 3300; // Ändra till önskad port
const JWT_SECRET = "supersecretkey"; // Går att bruteforca

// Skapa admin-användare
const adminUsername = "admin";
const adminPassword = "supersecretadmin12345";

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// Initiera en SQLite-databas (i minnet)
const db = new sqlite3.Database(":memory:");

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password TEXT,
    role TEXT DEFAULT 'user'
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS threads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    content TEXT,
    username TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);


  db.run(
    "INSERT OR IGNORE INTO users (username, password, role) VALUES (?, ?, ?)",
    [adminUsername, adminPassword, "admin"],
    function (err) {
      if (err) {
        console.error("Fel vid skapande av admin-användare:", err.message);
      } else {
        console.log("Admin-användare skapad (om den inte fanns).");
      }
    },
  );
});

/* Registrerings- och loginroutes
Parameterized query = ej vulnerable
Här kan man peta in role dock - Mass assignment
  */
app.post("/register", (req, res) => {
  const { username, password, role } = req.body;
  const userRole = role || "user";
  db.get("SELECT * FROM users WHERE username = ?", [username], (err, row) => {
    if (err) {
      console.error("Fel vid kontroll av användarnamn:", err.message);
      return res.status(500).json({ message: "Fel vid registrering" });
    }
    if (row) {
      return res
        .status(400)
        .json({ message: "Användarnamn är redan upptaget" });
    } else {
      const sql =
        "INSERT INTO users (username, password, role) VALUES (?, ?, ?)";
      db.run(sql, [username, password, userRole], function (err) {
        if (err) {
          console.error("Fel vid registrering:", err.message);
          return res.status(500).json({ message: "Fel vid registrering" });
        }
        res.json({ message: "Användare registrerad", userId: this.lastID });
      });
    }
  });
});

// inloggningsroute - SQLi
app.post("/login", (req, res) => {
  const { username, password } = req.body;
  const sql =
    "SELECT * FROM users WHERE username = '" +
    username +
    "' AND password = '" +
    password +
    "'";
  db.get(sql, (err, row) => {
    if (err) {
      console.error("Fel vid inloggning:", err.message);
      return res.status(500).json({ message: "Fel vid inloggning" });
    }
    if (row) {
      if (row.username === "admin") {
        console.log("Admin har loggat in vid " + new Date().toLocaleString());
      }
      const token = jwt.sign(
        { id: row.id, username: row.username, role: row.role },
        JWT_SECRET,
        { expiresIn: "1h" },
      );
      res.json({ message: "Inloggning lyckades", token: token });
    } else {
      res.status(401).json({ message: "Ogiltiga inloggningsuppgifter" });
    }
  });
});

// Middleware för JWT-autentisering
function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  if (!token) {
    return res.status(401).json({ message: "Ingen token tillhandahållen" });
  }
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ message: "Ogiltig token" });
    }
    req.user = user;
    next();
  });
}

// Route för att verifiera inloggning
app.get("/me", (req, res) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  if (!token) {
    return res.json({ loggedIn: false });
  }
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.json({ loggedIn: false });
    }
    res.json({ loggedIn: true, user });
  });
});

// Endpoint för att hämta trådar
app.get("/threads", (req, res) => {
  db.all("SELECT * FROM threads ORDER BY created_at DESC", [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json({ threads: rows });
  });
});

// Endpoint för att skapa nya trådar (kräver giltig JWT)
app.post("/threads", authenticateToken, (req, res) => {
  const { title, content, username } = req.body;

  if (!title || !content || !username) {
    return res.status(400).json({ error: "Titel och innehåll krävs" });
  }
  const sql = "INSERT INTO threads (title, content, username) VALUES (?, ?, ?)";
  db.run(sql, [title, content, username], function (err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json({ message: "Tråd skapad", threadId: this.lastID });
  });
});

// Admin-route
app.delete("/threads", authenticateToken, (req, res) => {
  if (req.user.username !== "admin") {
    return res.status(403).json({ message: "Endast admin har tillgång" });
  }
  db.run("DELETE FROM threads", (err) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json({ message: "Alla trådar borttagna" });
  });
});

// Sårbar DELETE-endpoint – IDOR
app.delete("/threads/:id", authenticateToken, (req, res) => {
  const threadId = req.params.id;

  db.run("DELETE FROM threads WHERE id = ?", [threadId], function (err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json({ message: "Tråd borttagen" });
  });
});

// Route för att hämta alla users
app.get("/users", authenticateToken, (req, res) => {
  db.all("SELECT id, username, role FROM users", [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json({ users: rows });
  });
});

// Statisk filserving
app.use(express.static(path.join(__dirname, "public")));

app.listen(port, () => {
  console.log(`Servern körs på http://localhost:${port}`);
});
