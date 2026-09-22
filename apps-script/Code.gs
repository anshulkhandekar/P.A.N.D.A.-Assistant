/* P.A.N.D.A. — paste into ONE Apps Script project bound to the private spreadsheet.
 * Google Apps Script uses JavaScript; application code is TypeScript.
 * USER CONFIGURATION: map your exact form question titles here.
 */
const FORM_FIELDS = {
  display_name: "What's your full name?",
  email_normalized: "Email Address",
  classification: "What's your classification?",
  major: "Whats your major? (4 letter code: CSCE, DAEN, STAT, etc.)",
  topic_comfort: "Self-rating: comfort with the topic today (Pick 1)",
  work_style: "How do you like to work?",
  current_goal: "What's your goal right now?",
  favorite_activity: "Pick your favorite activity out of this list",
  github_url:
    "What is your GitHub Profile URL? \n(Optional - Recommended if you want to participate in the warm-up activity. You can still participate without, just type N/A.)",
  github_enrichment_consent:
    "If you entered your GitHub profile, can P.A.N.D.A. use it to personalize advice?",
};
// Historical mappings prepared from your four header lists. Replace IDs and tab names.
// Titles below omit pasted Markdown formatting. The preview checks the REAL headers;
// adjust any title (especially mentorship) to exactly what appears in row 1.
// Put sources oldest first and preserve response row order. Existing member values win.
const HISTORICAL_SOURCES = [
  {
    label: "Sheet 1 — initial sign-in",
    spreadsheetId: "139yLbBeOB6gOW5VNvlFDXtO8PDM_vyI6cx88dBdswQs",
    sheetName: "Form Responses 1",
    fields: {
      email_normalized: "Email Address",
      classification: "Classification",
      experience_level: "What is your experience with Data Science",
      favorite_ice_cream: "Favorite ice cream flavor?",
      learning_goals: "Anything specific you would like to learn?",
      project_interest:
        "How interested are you in joining an ADSC Project this semester?",
    },
  },
  {
    label: "Sheet 2 — initial sign-in",
    spreadsheetId: "1gctgRXu6HgeSK3EwMtw71OlAZVQOFzSGZY_qfH04RKs",
    sheetName: "Form Responses 1",
    fields: {
      email_normalized: "Email Address",
      display_name: "What's your full name?",
      classification: "What's your classification?",
      major: "What's your major? (4 letter code: CSCE, DAEN, STAT, etc.)",
      project_application_intent: "Will you be applying to an ADSC project?",
      past_project_experience:
        "Have you done an ADSC project in the past? (Either member or manager)",
      dream_company: "What is your dream company?",
      career_interest:
        "What types of roles or industries are you most interested in pursuing?",
      mentorship_interest: `Would you be interested in participating in an informal peer mentorship program?
This would be a casual way to connect with other ADSC members for career-specific advice, technical guidance, college/life advice, or just questions you’d rather ask a peer. Mentorship would likely happen through optional Discord calls or drop-in sessions rather than scheduled 1-on-1 meetings`,
      organization_membership: "Which org are you a member of?",
    },
  },
  {
    label: "Sheet 3 — initial sign-in",
    spreadsheetId: "1DdvfxIF7RET_HTwy3O0pBS0e9sBZqa6BLe181Skt9bY",
    sheetName: "Form Responses 1",
    fields: {
      email_normalized: "Email Address",
      display_name: "What's your full name?",
      classification: "What's your classification?",
      major: "Whats your major? (4 letter code: CSCE, DAEN, STAT, etc.)",
      work_style: "How do you like to work?",
      topic_comfort: "Self-rating: comfort with the topic today (Pick 1)",
      favorite_activity: "Pick your favorite activity out of this list",
      career_fair_plans: "Are you going to the SEC Career Fair?",
      current_goal: "What's your goal right now?",
    },
  },
  {
    label: "Sheet 4 — AI in Production feedback",
    spreadsheetId: "1qXIZC1Mzoa48UniVlMvdZrCLbwHhkplFLxxpshVUxWM",
    sheetName: "Form Responses 1",
    fields: {
      email_normalized: "Email Address",
      requested_topics: "What do you want us to teach next?",
    },
    feedbackFields: {
      overall_experience:
        "How would you rate your overall experience with the AI in Production workshop?",
      comprehension:
        "How much of the presented material did you feel you comprehended?",
      depth_preference:
        "Regarding the technical depth of the content, which best describes your preference for future sessions?",
      confusing_topics:
        "Did you feel lost at any point? If so, please specify which topic caused the confusion.",
      suggested_change:
        "What is one specific change you would recommend to make this workshop more effective for you?",
    },
  },
];
const PUBLIC_FIELDS = ["Panda Code", "Display Name"]; // Only these two safe fields are accepted; either can be omitted.
const HEADERS = {
  Members: [
    "member_id",
    "email_normalized",
    "display_name",
    "first_name",
    "classification",
    "major",
    "career_interest",
    "secondary_interest",
    "experience_level",
    "work_style",
    "current_goal",
    "favorite_activity",
    "github_url",
    "github_enrichment_consent",
    "created_at",
    "updated_at",
    "last_seen_at",
    "raw_profile_json",
    "learning_goals",
    "favorite_ice_cream",
    "project_interest",
    "project_application_intent",
    "past_project_experience",
    "dream_company",
    "mentorship_interest",
    "organization_membership",
    "topic_comfort",
    "career_fair_plans",
    "requested_topics",
  ],
  SessionSignIns: [
    "event_id",
    "session_id",
    "session_sequence",
    "panda_code",
    "member_id",
    "display_name",
    "submitted_at",
    "processed_at",
    "greeting_status",
  ],
  EnrichmentCache: [
    "member_id",
    "github_username",
    "github_profile_json",
    "github_summary_json",
    "enriched_at",
    "status",
    "error_message",
  ],
  HistoricalResponses: [
    "import_id",
    "source_label",
    "source_spreadsheet_id",
    "source_sheet_name",
    "source_row",
    "submitted_at",
    "email_normalized",
    "member_id",
    "profile_json",
    "feedback_json",
  ],
  Config: ["key", "value"],
};
function normalizeEmail(s) {
  return String(s || "")
    .trim()
    .toLowerCase();
}
function normalizeName(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}
function safeCell(value) {
  const s = String(value == null ? "" : value);
  return /^[=+@-]/.test(s) ? "'" + s : s;
}
function rows(sheet) {
  const data = sheet.getDataRange().getDisplayValues();
  const headers = data.shift();
  if (new Set(headers).size !== headers.length)
    throw new Error("Duplicate headers in " + sheet.getName());
  return data.map((r, i) =>
    Object.assign(
      { _row: i + 2 },
      Object.fromEntries(headers.map((h, j) => [h, r[j] || ""])),
    ),
  );
}
function writeObject(sheet, headers, obj, row) {
  sheet
    .getRange(row || sheet.getLastRow() + 1, 1, 1, headers.length)
    .setValues([headers.map((h) => safeCell(obj[h]))]);
}
function ensureTab(book, name, headers) {
  const sheet = book.getSheetByName(name) || book.insertSheet(name);
  const actual = sheet.getLastRow()
    ? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    : [];
  // Append-only schema upgrades preserve existing rows and reject reordered columns.
  if (actual.length > headers.length || actual.some((h, i) => h !== headers[i]))
    throw new Error(
      "Unexpected headers in " + name + ". Do not overwrite existing data.",
    );
  if (sheet.getMaxColumns && sheet.getMaxColumns() < headers.length)
    sheet.insertColumnsAfter(
      sheet.getMaxColumns(),
      headers.length - sheet.getMaxColumns(),
    );
  if (actual.length < headers.length)
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  return sheet;
}
function config() {
  return Object.fromEntries(
    rows(SpreadsheetApp.getActive().getSheetByName("Config")).map((r) => [
      r.key,
      r.value,
    ]),
  );
}
function setConfig(key, value) {
  const sheet = SpreadsheetApp.getActive().getSheetByName("Config");
  const row = rows(sheet).find((r) => r.key === key);
  writeObject(sheet, HEADERS.Config, { key, value }, row && row._row);
}
function setupPanda() {
  const book = SpreadsheetApp.getActive();
  Object.keys(HEADERS).forEach((name) => ensureTab(book, name, HEADERS[name]));
  const current = config();
  const defaults = {
    session_id: "2026-09-22-backprop",
    session_name: "Backpropagation and Neural Networks",
    session_active: "FALSE",
    next_session_sequence: "1",
  };
  Object.keys(defaults).forEach((key) => {
    if (!current[key]) setConfig(key, defaults[key]);
  });
  const props = PropertiesService.getScriptProperties();
  const liveName =
    props.getProperty("LIVE_FORM_SHEET_NAME") || "Form Responses 1";
  const live = book.getSheetByName(liveName);
  if (!live)
    throw new Error("Link the live Form first, then set LIVE_FORM_SHEET_NAME.");
  if (!props.getProperty("LIVE_START_ROW"))
    props.setProperty("LIVE_START_ROW", String(live.getLastRow() + 1));
  console.log(
    "Setup complete. Configure properties and historical imports; activate session only before rehearsal.",
  );
}
function findExistingMember(members, email, name) {
  const normalized = normalizeEmail(email);
  const matches = normalized
    ? members.filter((m) => m.email_normalized === normalized)
    : members.filter(
        (m) => normalizeName(m.display_name) === normalizeName(name),
      );
  if (!normalized)
    console.warn("IDENTITY_NAME_FALLBACK: no email; review identity manually.");
  if (matches.length > 1)
    throw new Error(
      "Ambiguous member identity. Resolve duplicate records before retrying.",
    );
  return matches[0];
}
function mergeMemberProfile(old, incoming) {
  const result = Object.assign({}, old || {});
  Object.keys(incoming).forEach((k) => {
    if (String(incoming[k] || "").trim()) result[k] = incoming[k];
  });
  return result;
}
function profileFrom(named, fields, historical) {
  const profile = {};
  Object.keys(fields).forEach((k) => {
    const v = named[fields[k]];
    profile[k] = Array.isArray(v)
      ? v.join(", ").trim()
      : String(v || "").trim();
  });
  profile.email_normalized = normalizeEmail(profile.email_normalized);
  if (!profile.display_name && !historical)
    throw new Error("Missing name: check the form field mapping.");
  if (profile.display_name)
    profile.first_name = profile.display_name.split(/\s+/)[0];
  if (profile.github_enrichment_consent)
    profile.github_enrichment_consent =
      [
        "yes",
        "true",
        "yes, i consent",
        "i consent",
        "yes (i put my profile url above.)",
      ].includes(profile.github_enrichment_consent.toLowerCase())
        ? "true"
        : "false";
  return profile;
}
function upsertMember(profile, historical) {
  const sheet = SpreadsheetApp.getActive().getSheetByName("Members");
  const existing = findExistingMember(
    rows(sheet),
    profile.email_normalized,
    profile.display_name,
  );
  const now = new Date().toISOString();
  // Historical imports fill gaps; they must not replace current/live answers.
  // New sign-ins can also recover older email-only rows from the private ledger.
  const history = historical
    ? {}
    : historicalProfileFor(profile.email_normalized);
  const member = historical
    ? mergeMemberProfile(profile, existing || {})
    : mergeMemberProfile(mergeMemberProfile(history, existing || {}), profile);
  if (!member.display_name)
    throw new Error(
      "Member needs a name; retain unmatched history in HistoricalResponses.",
    );
  member.member_id = existing ? existing.member_id : Utilities.getUuid();
  member.created_at = existing ? existing.created_at : now;
  member.updated_at = now;
  if (!historical) member.last_seen_at = now;
  if (!member.github_enrichment_consent)
    member.github_enrichment_consent = "false";
  // Do not retain unmapped feedback or potentially sensitive free text by default.
  member.raw_profile_json = existing ? existing.raw_profile_json : "";
  writeObject(sheet, HEADERS.Members, member, existing && existing._row);
  console.log(
    JSON.stringify({
      event: existing ? "MEMBER_UPDATED" : "MEMBER_CREATED",
      memberId: member.member_id,
    }),
  );
  return member;
}
function allocatePandaCode(cfg, events) {
  const next = Number(cfg.next_session_sequence);
  if (!Number.isInteger(next) || next < 1)
    throw new Error("Invalid next_session_sequence");
  const max = events
    .filter((e) => e.session_id === cfg.session_id)
    .reduce((n, e) => Math.max(n, Number(e.session_sequence)), 0);
  const sequence = Math.max(next, max + 1);
  if (sequence > 100) throw new Error("This workshop supports Panda 1–100.");
  return sequence;
}
function appendSessionSignIn(event) {
  writeObject(
    SpreadsheetApp.getActive().getSheetByName("SessionSignIns"),
    HEADERS.SessionSignIns,
    event,
  );
}
function publicTab() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty("PUBLIC_SPREADSHEET_ID");
  if (!id || id === SpreadsheetApp.getActive().getId())
    throw new Error(
      "PUBLIC_SPREADSHEET_ID must refer to a DIFFERENT spreadsheet.",
    );
  if (
    !PUBLIC_FIELDS.length ||
    PUBLIC_FIELDS.some((h) => !["Panda Code", "Display Name"].includes(h))
  )
    throw new Error("Unsafe PUBLIC_FIELDS configuration");
  const book = SpreadsheetApp.openById(id);
  return (
    book.getSheetByName(
      props.getProperty("PUBLIC_SHEET_NAME") || "Panda Codes",
    ) ||
    book.insertSheet(props.getProperty("PUBLIC_SHEET_NAME") || "Panda Codes")
  );
}
function appendPublicCode() {
  // Idempotent snapshot: the private event ledger is authoritative. No extra private ID is published.
  const cfg = config();
  const events = rows(
    SpreadsheetApp.getActive().getSheetByName("SessionSignIns"),
  )
    .filter((e) => e.session_id === cfg.session_id)
    .sort((a, b) => Number(a.session_sequence) - Number(b.session_sequence));
  const sheet = publicTab();
  const data = [PUBLIC_FIELDS].concat(
    events.map((e) =>
      PUBLIC_FIELDS.map((h) =>
        safeCell(
          h === "Panda Code" ? "Panda " + e.session_sequence : e.display_name,
        ),
      ),
    ),
  );
  const previous = sheet.getLastRow();
  sheet.getRange(1, 1, data.length, PUBLIC_FIELDS.length).setValues(data);
  if (previous > data.length)
    sheet
      .getRange(
        data.length + 1,
        1,
        previous - data.length,
        Math.max(sheet.getLastColumn(), 2),
      )
      .clearContent();
  if (sheet.getLastColumn() > PUBLIC_FIELDS.length)
    sheet
      .getRange(
        1,
        PUBLIC_FIELDS.length + 1,
        sheet.getMaxRows(),
        sheet.getLastColumn() - PUBLIC_FIELDS.length,
      )
      .clearContent();
}
function processSubmission(e) {
  const cfg = config();
  if (cfg.session_active !== "TRUE") throw new Error("Session is not active");
  const props = PropertiesService.getScriptProperties();
  if (
    e.range.getSheet().getName() !==
    (props.getProperty("LIVE_FORM_SHEET_NAME") || "Form Responses 1")
  )
    throw new Error("Unexpected live form tab");
  const eventId =
    cfg.session_id +
    ":" +
    e.range.getSheet().getSheetId() +
    ":" +
    e.range.getRow();
  const events = rows(
    SpreadsheetApp.getActive().getSheetByName("SessionSignIns"),
  );
  const previous = events.find((r) => r.event_id === eventId);
  if (previous) {
    appendPublicCode();
    return;
  } // Retry after any public-write failure never allocates a new code.
  const member = upsertMember(profileFrom(e.namedValues, FORM_FIELDS), false);
  const sequence = allocatePandaCode(cfg, events);
  const now = new Date().toISOString();
  // Write the event ledger BEFORE the counter. A failed counter write recovers from the maximum ledger value.
  appendSessionSignIn({
    event_id: eventId,
    session_id: cfg.session_id,
    session_sequence: sequence,
    panda_code: "P" + sequence,
    member_id: member.member_id,
    display_name: member.display_name,
    submitted_at: String((e.values && e.values[0]) || now),
    processed_at: now,
    greeting_status: "pending",
  });
  SpreadsheetApp.flush();
  setConfig("next_session_sequence", sequence + 1);
  appendPublicCode();
  console.log(
    JSON.stringify({
      event: "PANDA_CODE_ASSIGNED",
      eventId,
      pandaCode: "P" + sequence,
    }),
  );
}
function onFormSubmit(e) {
  if (!e || !e.range || !e.namedValues)
    throw new Error(
      "Use an INSTALLABLE spreadsheet form-submit trigger; do not run this function directly.",
    );
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    processSubmission(e);
    SpreadsheetApp.flush();
  } catch (error) {
    console.error("FORM_PROCESSING_FAILED: " + error.message);
    throw error;
  } finally {
    lock.releaseLock();
  }
}
function repairLiveSubmissions() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const props = PropertiesService.getScriptProperties();
    const sheet = SpreadsheetApp.getActive().getSheetByName(
      props.getProperty("LIVE_FORM_SHEET_NAME") || "Form Responses 1",
    );
    const start = Number(props.getProperty("LIVE_START_ROW"));
    if (!start || start < 2)
      throw new Error(
        "Set LIVE_START_ROW to the first response row of this session.",
      );
    const data = sheet.getDataRange().getDisplayValues();
    const headers = data[0];
    const cfg = config();
    const done = new Set(
      rows(SpreadsheetApp.getActive().getSheetByName("SessionSignIns")).map(
        (r) => r.event_id,
      ),
    );
    let count = 0;
    for (let row = start; row <= data.length && count < 20; row++) {
      const id = cfg.session_id + ":" + sheet.getSheetId() + ":" + row;
      if (done.has(id)) continue;
      processSubmission({
        range: sheet.getRange(row, 1, 1, headers.length),
        namedValues: Object.fromEntries(
          headers.map((h, i) => [h, [data[row - 1][i]]]),
        ),
        values: data[row - 1],
      });
      count++;
    }
    appendPublicCode();
    SpreadsheetApp.flush();
    console.log(
      "Repair complete. Processed " +
        count +
        " missing events. Repeat if more than 20 were missing.",
    );
  } finally {
    lock.releaseLock();
  }
}
// Private response ledger: never returned to the projector or the language model.
function historicalProfileFor(email) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(
    "HistoricalResponses",
  );
  if (!sheet || !normalizeEmail(email)) return {};
  let profile = {};
  for (const row of rows(sheet)) {
    if (normalizeEmail(row.email_normalized) === normalizeEmail(email))
      profile = mergeMemberProfile(
        profile,
        JSON.parse(row.profile_json || "{}"),
      );
  }
  return profile;
}
function loadHistoricalSources() {
  return HISTORICAL_SOURCES.map((source) => {
    if (!source.spreadsheetId || source.spreadsheetId.startsWith("PASTE_"))
      throw new Error("Set the spreadsheet ID for " + source.label);
    const sheet = SpreadsheetApp.openById(source.spreadsheetId).getSheetByName(
      source.sheetName,
    );
    if (!sheet) throw new Error("Historical tab missing: " + source.label);
    const headers = sheet.getDataRange().getDisplayValues()[0];
    for (const [key, title] of Object.entries(source.fields || {})) {
      if (!HEADERS.Members.includes(key))
        throw new Error("Unsupported member field: " + key);
      if (!headers.includes(title))
        throw new Error(
          source.label + ": header not found for " + key + ": " + title,
        );
    }
    for (const title of Object.values(source.feedbackFields || {}))
      if (!headers.includes(title))
        throw new Error(source.label + ": feedback header not found: " + title);
    return {
      source,
      entries: rows(sheet)
        .filter((row) => headers.some((h) => row[h]))
        .map((row) => ({
          row,
          profile: profileFrom(row, source.fields, true),
          feedback: Object.fromEntries(
            Object.entries(source.feedbackFields || {}).map(([key, title]) => [
              key,
              row[title] || "",
            ]),
          ),
        })),
    };
  });
}
function historicalSummary(loaded) {
  const known = new Set(
    rows(SpreadsheetApp.getActive().getSheetByName("Members"))
      .filter((m) => m.display_name && m.email_normalized)
      .map((m) => normalizeEmail(m.email_normalized)),
  );
  for (const { entries } of loaded)
    for (const { profile } of entries)
      if (profile.email_normalized && profile.display_name)
        known.add(profile.email_normalized);
  return loaded.map(({ source, entries }) => ({
    source: source.label,
    rows: entries.length,
    missingEmail: entries.filter((e) => !e.profile.email_normalized).length,
    emailOnlyMatched: entries.filter(
      (e) => !e.profile.display_name && known.has(e.profile.email_normalized),
    ).length,
    emailOnlyUnmatched: entries.filter(
      (e) =>
        e.profile.email_normalized &&
        !e.profile.display_name &&
        !known.has(e.profile.email_normalized),
    ).length,
  }));
}
function previewHistoricalImport() {
  const summary = historicalSummary(loadHistoricalSources());
  console.log(JSON.stringify(summary));
  return summary;
}
function importHistoricalMembers() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    // Validate every source before writing anything, including exact header matches.
    const loaded = loadHistoricalSources();
    console.log(JSON.stringify(historicalSummary(loaded)));
    const book = SpreadsheetApp.getActive();
    const memberSheet = ensureTab(book, "Members", HEADERS.Members);
    const ledger = ensureTab(
      book,
      "HistoricalResponses",
      HEADERS.HistoricalResponses,
    );
    const existingLedger = new Map(rows(ledger).map((r) => [r.import_id, r]));
    const grouped = new Map();
    // First collect all names/fields; Sheet 1 can match a name from Sheet 2 or 3.
    for (const { entries } of loaded)
      for (const { profile } of entries) {
        if (!profile.email_normalized) continue; // No guessing a feedback author's identity.
        grouped.set(
          profile.email_normalized,
          mergeMemberProfile(grouped.get(profile.email_normalized), profile),
        );
      }
    const members = rows(memberSheet);
    const resolved = new Map();
    for (const [email, profile] of grouped) {
      const existing = findExistingMember(members, email, "");
      if (!profile.display_name && !existing?.display_name) continue;
      const member = upsertMember(profile, true);
      resolved.set(email, member.member_id);
    }
    for (const { source, entries } of loaded)
      for (const { row, profile, feedback } of entries) {
        const importId = JSON.stringify([
          source.spreadsheetId,
          source.sheetName,
          row._row,
        ]);
        const previous = existingLedger.get(importId);
        writeObject(
          ledger,
          HEADERS.HistoricalResponses,
          {
            import_id: importId,
            source_label: source.label,
            source_spreadsheet_id: source.spreadsheetId,
            source_sheet_name: source.sheetName,
            source_row: row._row,
            submitted_at: row.Timestamp || "",
            email_normalized: profile.email_normalized,
            member_id: resolved.get(profile.email_normalized) || "",
            profile_json: JSON.stringify(profile),
            feedback_json: JSON.stringify(feedback),
          },
          previous && previous._row,
        );
      }
    SpreadsheetApp.flush();
    console.log(
      "Historical import complete. Unmatched responses retained privately; no codes or greetings created.",
    );
  } finally {
    lock.releaseLock();
  }
}
