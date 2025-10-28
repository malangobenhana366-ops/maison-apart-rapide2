/**
 * maisonServeur - server.js (version avancée)
 *
 * Caractéristiques :
 * - Stockage local des données (dossier /data/*.json)
 * - Upload d'images dans /uploads (max 5 images par annonce)
 * - Validation des champs pour les maisons
 * - Module paiements : enregistre paiements (numéro manuel +243831401205)
 * - Tableau admin protégé par mot de passe simple (Ben&4002)
 * - Journalisation actions admin (logs/admin-actions.log)
 *
 * Dépendances : express, multer, cors, uuid, fs-extra
 * Installer : npm i express multer cors uuid fs-extra
 */

const express = require("express");
const multer = require("multer");
const cors = require("cors");
const fs = require("fs-extra");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

//////////////////////
// Configuration
//////////////////////

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Ben&4002"; // mot de passe admin fourni
const PAYMENT_PHONE = process.env.PAYMENT_PHONE || "+243831401205"; // numéro où on reçoit l'argent
const MAX_IMAGES = 5;
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5 MB par image (ajustable)

const BASE_DIR = __dirname;
const UPLOAD_DIR = path.join(BASE_DIR, "uploads");
const DATA_DIR = path.join(BASE_DIR, "data");
const LOG_DIR = path.join(BASE_DIR, "logs");
const ADMIN_LOG = path.join(LOG_DIR, "admin-actions.log");

// fichiers data
const MAISONS_FILE = path.join(DATA_DIR, "maisons.json");
const USERS_FILE = path.join(DATA_DIR, "utilisateurs.json");
const PAIEMENTS_FILE = path.join(DATA_DIR, "paiements.json");
const TRANSACTIONS_FILE = path.join(DATA_DIR, "transactions.json");

//////////////////////
// Init dossiers/fichiers
//////////////////////
fs.ensureDirSync(UPLOAD_DIR);
fs.ensureDirSync(DATA_DIR);
fs.ensureDirSync(LOG_DIR);

function ensureJsonFile(filePath, initial = []) {
  if (!fs.existsSync(filePath)) {
    fs.writeJsonSync(filePath, initial, { spaces: 2 });
  }
}
ensureJsonFile(MAISONS_FILE, []);
ensureJsonFile(USERS_FILE, []);
ensureJsonFile(PAIEMENTS_FILE, []);
ensureJsonFile(TRANSACTIONS_FILE, []);

function readJson(filePath) {
  try {
    return fs.readJsonSync(filePath);
  } catch (err) {
    console.error("Erreur lecture JSON", filePath, err);
    return [];
  }
}
function writeJson(filePath, data) {
  fs.writeJsonSync(filePath, data, { spaces: 2 });
}

function logAdmin(action, details = "") {
  const line = `${new Date().toISOString()} | ${action} | ${details}\n`;
  fs.appendFileSync(ADMIN_LOG, line);
}

//////////////////////
// Multer config (upload images)
//////////////////////
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || ".jpg";
    cb(null, Date.now() + "-" + uuidv4() + ext);
  }
});

function fileFilter(req, file, cb) {
  // accept images only
  if (!file.mimetype.startsWith("image/")) {
    return cb(new Error("Seules les images sont autorisées"));
  }
  cb(null, true);
}

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_IMAGE_SIZE }
});

//////////////////////
// Express App
//////////////////////
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Servir frontend si tu veux (index.html dans le même dossier)
app.use("/", express.static(BASE_DIR));
// servir les images uploadées
app.use("/uploads", express.static(UPLOAD_DIR));

//////////////////////
// Middlewares utilitaires
//////////////////////
function adminAuth(req, res, next) {
  const key = (req.headers.authorization || "").trim();
  if (!key || key !== ADMIN_PASSWORD) {
    return res.status(403).json({ success: false, message: "Accès admin refusé" });
  }
  next();
}

function validateMaisonFields(body) {
  // champs obligatoires: titre, prix, ville, commune, quartier
  const errors = [];
  if (!body.titre || body.titre.trim().length < 3) errors.push("titre (min 3)");
  if (!body.prix || isNaN(Number(body.prix))) errors.push("prix (nombre)");
  if (!body.ville || body.ville.trim().length < 2) errors.push("ville");
  if (!body.commune || body.commune.trim().length < 1) errors.push("commune");
  if (!body.quartier || body.quartier.trim().length < 1) errors.push("quartier");
  return errors;
}

//////////////////////
// Routes publiques - Maisons
//////////////////////

// GET /api/maisons  -> renvoie uniquement maisons validées (statut: "valide")
app.get("/api/maisons", (req, res) => {
  const all = readJson(MAISONS_FILE);
  const onlyValidated = all.filter(m => m.statut === "valide");
  res.json(onlyValidated);
});

// GET /api/maisons/:id
app.get("/api/maisons/:id", (req, res) => {
  const all = readJson(MAISONS_FILE);
  const maison = all.find(m => m.id === req.params.id);
  if (!maison) return res.status(404).json({ success: false, message: "Maison introuvable" });
  res.json(maison);
});

// POST /api/maisons - ajoute annonce avec images (max 5)
app.post("/api/maisons", upload.array("images", MAX_IMAGES), (req, res) => {
  try {
    // fields: titre, description, prix, ville, commune, quartier, garantie, localisation, auteur (utilisateurId)
    const body = req.body;
    const validation = validateMaisonFields(body);
    if (validation.length) {
      // supprimer les fichiers transférés si validation échoue
      (req.files || []).forEach(f => fs.removeSync(f.path));
      return res.status(400).json({ success: false, message: "Champs invalides", errors: validation });
    }

    // gérer images
    const images = (req.files || []).slice(0, MAX_IMAGES).map(f => {
      // url accessible : /uploads/filename
      return `/uploads/${f.filename}`;
    });

    const maisons = readJson(MAISONS_FILE);
    const newMaison = {
      id: uuidv4(),
      titre: body.titre.trim(),
      description: body.description || "",
      prix: Number(body.prix),
      ville: body.ville,
      commune: body.commune,
      quartier: body.quartier,
      garantie: body.garantie || "",
      localisation: body.localisation || "",
      images,
      auteur: body.auteur || null,
      statut: "en_attente", // en_attente / valide / refuse
      datePublication: new Date().toISOString()
    };

    maisons.push(newMaison);
    writeJson(MAISONS_FILE, maisons);

    return res.json({ success: true, message: "Annonce ajoutée (en attente de validation)", maison: newMaison });
  } catch (err) {
    console.error("Erreur POST /api/maisons", err);
    return res.status(500).json({ success: false, message: "Erreur serveur lors de l'ajout" });
  }
});

//////////////////////
// Routes - Utilisateurs (simple)
//////////////////////

// POST /api/utilisateurs -> créer utilisateur minimal
app.post("/api/utilisateurs", (req, res) => {
  const { nom, telephone } = req.body;
  if (!nom || !telephone) return res.status(400).json({ success: false, message: "nom et telephone requis" });

  const users = readJson(USERS_FILE);
  const user = { id: uuidv4(), nom: nom.trim(), telephone: telephone.trim(), maisons: [] };
  users.push(user);
  writeJson(USERS_FILE, users);
  res.json({ success: true, message: "Utilisateur créé", utilisateur: user });
});

//////////////////////
// Routes - Paiements (enregistrement manuel)
//////////////////////

// POST /api/paiements
// body: { utilisateurId, maisonId, montant, reference (optionnel), methode (optionnel) }
app.post("/api/paiements", (req, res) => {
  const { utilisateurId, maisonId, montant, reference, methode } = req.body;
  if (!utilisateurId || !maisonId || !montant) return res.status(400).json({ success: false, message: "utilisateurId, maisonId, montant requis" });

  const paiements = readJson(PAIEMENTS_FILE);
  const paiement = {
    id: uuidv4(),
    utilisateur: utilisateurId,
    maison: maisonId,
    montant: Number(montant),
    reference: reference || null,
    methode: methode || "mobile_money",
    statut: "en_attente", // en_attente / valide / refuse
    date: new Date().toISOString(),
    receptionPhone: PAYMENT_PHONE // numéro où l'argent est envoyé
  };
  paiements.push(paiement);
  writeJson(PAIEMENTS_FILE, paiements);

  // réponse claire pour utilisateur
  res.json({
    success: true,
    message: `Paiement enregistré. Envoyez l'argent au numéro ${PAYMENT_PHONE} et prévenez l'admin pour validation.`,
    paiement
  });
});

// GET /api/paiements/:id
app.get("/api/paiements/:id", (req, res) => {
  const list = readJson(PAIEMENTS_FILE);
  const p = list.find(x => x.id === req.params.id);
  if (!p) return res.status(404).json({ success: false, message: "Paiement introuvable" });
  res.json(p);
});

//////////////////////
// Routes Admin (protégées)
//////////////////////

// GET /api/admin/maisons -> voir toutes maisons (admin)
app.get("/api/admin/maisons", adminAuth, (req, res) => {
  const maisons = readJson(MAISONS_FILE);
  res.json(maisons);
});

// POST /api/admin/validerMaison -> body { id }
app.post("/api/admin/validerMaison", adminAuth, (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ success: false, message: "id requis" });
  const maisons = readJson(MAISONS_FILE);
  const m = maisons.find(x => x.id === id);
  if (!m) return res.status(404).json({ success: false, message: "Maison non trouvée" });
  m.statut = "valide";
  writeJson(MAISONS_FILE, maisons);
  logAdmin("VALIDER_MAISON", `id=${id} titre=${m.titre}`);
  res.json({ success: true, message: "Maison validée", maison: m });
});

// POST /api/admin/refuserMaison -> body { id, raison (optionnel) }
app.post("/api/admin/refuserMaison", adminAuth, (req, res) => {
  const { id, raison } = req.body;
  if (!id) return res.status(400).json({ success: false, message: "id requis" });
  let maisons = readJson(MAISONS_FILE);
  const m = maisons.find(x => x.id === id);
  if (!m) return res.status(404).json({ success: false, message: "Maison non trouvée" });
  m.statut = "refuse";
  m.refuseReason = raison || "";
  writeJson(MAISONS_FILE, maisons);
  logAdmin("REFUSER_MAISON", `id=${id} raison=${raison||"non précisée"}`);
  res.json({ success: true, message: "Maison refusée", maison: m });
});

// POST /api/admin/supprimerMaison -> body { id }
app.post("/api/admin/supprimerMaison", adminAuth, (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ success: false, message: "id requis" });
  let maisons = readJson(MAISONS_FILE);
  const m = maisons.find(x => x.id === id);
  if (!m) return res.status(404).json({ success: false, message: "Maison non trouvée" });
  // supprimer images associées (si besoin)
  if (Array.isArray(m.images)) {
    m.images.forEach(imgPath => {
      const filePath = path.join(BASE_DIR, imgPath);
      try { if (fs.existsSync(filePath)) fs.removeSync(filePath); } catch (e) { /* ignore */ }
    });
  }
  maisons = maisons.filter(x => x.id !== id);
  writeJson(MAISONS_FILE, maisons);
  logAdmin("SUPPRIMER_MAISON", `id=${id} titre=${m.titre}`);
  res.json({ success: true, message: "Maison supprimée" });
});

//////////////////////
// Admin - Paiements
//////////////////////

// GET /api/admin/paiements -> liste paiements (admin)
app.get("/api/admin/paiements", adminAuth, (req, res) => {
  const paiements = readJson(PAIEMENTS_FILE);
  res.json(paiements);
});

// POST /api/admin/validerPaiement -> body { paiementId }
app.post("/api/admin/validerPaiement", adminAuth, (req, res) => {
  const { paiementId } = req.body;
  if (!paiementId) return res.status(400).json({ success: false, message: "paiementId requis" });
  const paiements = readJson(PAIEMENTS_FILE);
  const p = paiements.find(x => x.id === paiementId);
  if (!p) return res.status(404).json({ success: false, message: "Paiement non trouvé" });
  p.statut = "valide";
  // enregistrer transaction
  const transactions = readJson(TRANSACTIONS_FILE);
  transactions.push({ id: uuidv4(), paiementId: p.id, montant: p.montant, date: new Date().toISOString() });
  writeJson(PAIEMENTS_FILE, paiements);
  writeJson(TRANSACTIONS_FILE, transactions);
  logAdmin("VALIDER_PAIEMENT", `paiementId=${paiementId} montant=${p.montant}`);
  res.json({ success: true, message: "Paiement validé", paiement: p });
});

// POST /api/admin/refuserPaiement -> body { paiementId, raison (opt) }
app.post("/api/admin/refuserPaiement", adminAuth, (req, res) => {
  const { paiementId, raison } = req.body;
  if (!paiementId) return res.status(400).json({ success: false, message: "paiementId requis" });
  const paiements = readJson(PAIEMENTS_FILE);
  const p = paiements.find(x => x.id === paiementId);
  if (!p) return res.status(404).json({ success: false, message: "Paiement non trouvé" });
  p.statut = "refuse";
  p.refuseReason = raison || "";
  writeJson(PAIEMENTS_FILE, paiements);
  logAdmin("REFUSER_PAIEMENT", `paiementId=${paiementId} raison=${raison||"non précisée"}`);
  res.json({ success: true, message: "Paiement refusé", paiement: p });
});

//////////////////////
// Admin - Utilisateurs & Stats
//////////////////////

// GET /api/admin/utilisateurs
app.get("/api/admin/utilisateurs", adminAuth, (req, res) => {
  const u = readJson(USERS_FILE);
  res.json(u);
});

// POST /api/admin/supprimerUtilisateur -> body { id }
app.post("/api/admin/supprimerUtilisateur", adminAuth, (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ success: false, message: "id requis" });
  let users = readJson(USERS_FILE);
  users = users.filter(x => x.id !== id);
  writeJson(USERS_FILE, users);
  logAdmin("SUPPRIMER_UTILISATEUR", `id=${id}`);
  res.json({ success: true, message: "Utilisateur supprimé" });
});

// GET /api/admin/stats
app.get("/api/admin/stats", adminAuth, (req, res) => {
  const maisons = readJson(MAISONS_FILE);
  const users = readJson(USERS_FILE);
  const paiements = readJson(PAIEMENTS_FILE);
  const transactions = readJson(TRANSACTIONS_FILE);
  const revenusTotaux = transactions.reduce((s, t) => s + (t.montant || 0), 0);
  res.json({
    totalMaisons: maisons.length,
    totalUsers: users.length,
    totalPaiements: paiements.length,
    revenusTotaux
  });
});

//////////////////////
// Debug / health
//////////////////////
app.get("/api/health", (req, res) => res.json({ ok: true, server: "maisonServeur", time: new Date().toISOString() }));

//////////////////////
// Global error handler
//////////////////////
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ success: false, message: err.message });
  }
  res.status(500).json({ success: false, message: "Erreur serveur", error: String(err.message || err) });
});

//////////////////////
// Démarrage serveur
//////////////////////
app.listen(PORT, () => {
  console.log(`maisonServeur (backend avancé) démarré sur http://localhost:${PORT}`);
  console.log(`Admin password (par défaut): ${ADMIN_PASSWORD}`);
  console.log(`Paiements -> envoyer argent vers: ${PAYMENT_PHONE}`);
});