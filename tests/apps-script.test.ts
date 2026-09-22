import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, it, expect } from "vitest";
class Sheet {
  data: any[][] = [];
  constructor(
    public name: string,
    public id = 1,
  ) {}
  getName() {
    return this.name;
  }
  getSheetId() {
    return this.id;
  }
  getLastRow() {
    return this.data.length;
  }
  getLastColumn() {
    return Math.max(0, ...this.data.map((r) => r.length));
  }
  getMaxRows() {
    return Math.max(100, this.data.length);
  }
  appendRow(row: any[]) {
    this.data.push(row);
    return this;
  }
  getDataRange() {
    return this.getRange(
      1,
      1,
      Math.max(1, this.data.length),
      Math.max(1, this.getLastColumn()),
    );
  }
  getRange(row: number, col: number, height = 1, width = 1) {
    const self = this;
    return {
      getSheet: () => self,
      getRow: () => row,
      getValues: () =>
        Array.from({ length: height }, (_, i) =>
          Array.from(
            { length: width },
            (_, j) => self.data[row + i - 1]?.[col + j - 1] ?? "",
          ),
        ),
      getDisplayValues() {
        return this.getValues().map((r) => r.map(String));
      },
      setValues(values: any[][]) {
        values.forEach((r, i) => {
          self.data[row + i - 1] ||= [];
          r.forEach((v, j) => (self.data[row + i - 1][col + j - 1] = v));
        });
        return this;
      },
      clearContent() {
        for (let i = 0; i < height; i++)
          for (let j = 0; j < width; j++)
            if (self.data[row + i - 1])
              self.data[row + i - 1][col + j - 1] = "";
      },
    };
  }
}
function fixture() {
  const tabs = new Map<string, Sheet>();
  const pub = new Map<string, Sheet>();
  const historicalBooks = new Map<string, Map<string, Sheet>>();
  const props = new Map([
    ["PUBLIC_SPREADSHEET_ID", "public"],
    ["LIVE_START_ROW", "2"],
  ]);
  const live = new Sheet("Form Responses 1", 42);
  live.appendRow(["Timestamp", "Name", "Email Address"]);
  tabs.set(live.name, live);
  let failPublic = false;
  let held = false;
  let uuid = 0;
  const book = {
    getId: () => "private",
    getSheetByName: (name: string) => tabs.get(name),
    insertSheet: (name: string) => {
      const s = new Sheet(name);
      tabs.set(name, s);
      return s;
    },
  };
  const context = vm.createContext({
    console: { log() {}, warn() {}, error() {} },
    SpreadsheetApp: {
      getActive: () => book,
      flush() {
        expect(held || uuid === 0).toBeTruthy();
      },
      openById: (id: string) => {
        if (failPublic) throw Error("injected public failure");
        if (id === "private") return book;
        if (historicalBooks.has(id))
          return {
            getSheetByName: (name: string) =>
              historicalBooks.get(id)!.get(name),
          };
        return {
          getSheetByName: (name: string) => pub.get(name),
          insertSheet: (name: string) => {
            const s = new Sheet(name);
            pub.set(name, s);
            return s;
          },
        };
      },
    },
    Utilities: { getUuid: () => `uuid-${++uuid}` },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k: string) => props.get(k),
        setProperty: (k: string, v: string) => props.set(k, v),
      }),
    },
    LockService: {
      getScriptLock: () => ({
        waitLock() {
          expect(held).toBe(false);
          held = true;
        },
        releaseLock() {
          held = false;
        },
      }),
    },
  });
  vm.runInContext(readFileSync("apps-script/Code.gs", "utf8"), context);
  vm.runInContext("setupPanda();setConfig('session_active','TRUE')", context);
  const submit = (
    row: number,
    name = "Jordan Smith",
    email = "jordan@example.com",
  ) => {
    const e = {
      range: live.getRange(row, 1),
      namedValues: {
        [vm.runInContext("FORM_FIELDS.display_name", context)]: [name],
        "Email Address": [email],
      },
      values: ["2026-09-22", name, email],
    };
    context.onFormSubmit(e);
  };
  return {
    context,
    historicalBooks,
    tabs,
    pub,
    submit,
    fail: (v: boolean) => {
      failPublic = v;
    },
    held: () => held,
    props,
  };
}
describe("actual Apps Script processing", () => {
  it("reads the live GitHub URL header including its space before the newline", () => {
    const f = fixture();
    f.context.submittedAnswers = {
      "What's your full name?": ["Jordan Smith"],
      "What is your GitHub Profile URL? \n(Optional - Recommended if you want to participate in the warm-up activity. You can still participate without, just type N/A.)": ["https://github.com/octocat"],
    };
    const profile = vm.runInContext("profileFrom(submittedAnswers, FORM_FIELDS)", f.context);
    expect(profile.github_url).toBe("https://github.com/octocat");
  });
  it.each([
    ["Yes (I put my profile URL above.)", "true"],
    ["No (I didn't put my profile URL above.)", "false"],
    ["Yes", "true"],
    ["true", "true"],
    ["I consent", "true"],
    ["Yes, I consent", "true"],
    ["Yes, but don't use my profile", "false"],
  ])("parses explicit GitHub consent %s as %s", (answer, expected) => {
    const f = fixture();
    f.context.answer = answer;
    const profile = vm.runInContext(
      `profileFrom({
        [FORM_FIELDS.display_name]: ['Jordan Smith'],
        [FORM_FIELDS.github_enrichment_consent]: [answer]
      }, FORM_FIELDS)`,
      f.context,
    );
    expect(profile.github_enrichment_consent).toBe(expected);
  });
  it("a live No answer revokes previously granted GitHub consent", () => {
    const f = fixture();
    vm.runInContext(`
      const named = {
        [FORM_FIELDS.display_name]: ['Jordan Smith'],
        [FORM_FIELDS.email_normalized]: ['jordan@example.com'],
        [FORM_FIELDS.github_enrichment_consent]: ['Yes (I put my profile URL above.)']
      };
      upsertMember(profileFrom(named, FORM_FIELDS), false);
      named[FORM_FIELDS.github_enrichment_consent] = ["No (I didn't put my profile URL above.)"];
      upsertMember(profileFrom(named, FORM_FIELDS), false);
    `, f.context);
    expect(memberObjects(f)[0].github_enrichment_consent).toBe("false");
  });
  it("serializes ten submissions with unique codes and safe public fields", () => {
    const f = fixture();
    for (let i = 0; i < 10; i++)
      f.submit(i + 2, "Member " + i, "m" + i + "@example.com");
    const events = f.tabs.get("SessionSignIns")!.data.slice(1);
    expect(events.map((e) => e[3])).toEqual(
      Array.from({ length: 10 }, (_, i) => "P" + (i + 1)),
    );
    expect(f.pub.get("Panda Codes")!.data[0]).toEqual([
      "Panda Code",
      "Display Name",
    ]);
    expect(f.pub.get("Panda Codes")!.data.every((r) => r.length === 2)).toBe(
      true,
    );
    expect(f.held()).toBe(false);
  });
  it("retry after public failure does not allocate or create twice", () => {
    const f = fixture();
    f.fail(true);
    expect(() => f.submit(2)).toThrow("injected");
    expect(f.held()).toBe(false);
    f.fail(false);
    f.submit(2);
    expect(f.tabs.get("Members")!.data).toHaveLength(2);
    expect(f.tabs.get("SessionSignIns")!.data).toHaveLength(2);
    expect(f.pub.get("Panda Codes")!.data).toHaveLength(2);
  });
  it("uses ledger maximum when counter is stale", () => {
    const f = fixture();
    f.submit(2);
    vm.runInContext("setConfig('next_session_sequence','1')", f.context);
    f.submit(3, "Alex", "alex@example.com");
    expect(f.tabs.get("SessionSignIns")!.data[2][3]).toBe("P2");
  });
  it("returning email keeps stable ID; a repeated attendance event gets its own code", () => {
    const f = fixture();
    f.submit(2);
    f.submit(3, "Jordan", " JORDAN@EXAMPLE.COM ");
    expect(f.tabs.get("Members")!.data).toHaveLength(2);
    const e = f.tabs.get("SessionSignIns")!.data;
    expect(e[1][4]).toBe(e[2][4]);
  });
  it("cannot accidentally publish into the private spreadsheet", () => {
    const f = fixture();
    f.props.set("PUBLIC_SPREADSHEET_ID", "private");
    expect(() => f.submit(2)).toThrow("DIFFERENT");
  });
  it("escapes formula injection in names", () => {
    const f = fixture();
    f.submit(2, '=IMPORTXML("bad")');
    expect(f.pub.get("Panda Codes")!.data[1][1]).toMatch(/^'/);
  });
  it("historical import helper does not create events or imply consent", () => {
    const f = fixture();
    vm.runInContext(
      "upsertMember({display_name:'Old Member',email_normalized:'old@example.com',github_url:'https://github.com/octocat'},true)",
      f.context,
    );
    const headers = f.tabs.get("Members")!.data[0];
    const m = f.tabs.get("Members")!.data[1];
    expect(m[headers.indexOf("github_enrichment_consent")]).toBe("false");
    expect(f.tabs.get("SessionSignIns")!.data).toHaveLength(1);
    expect(f.pub.size).toBe(0);
  });
});

function historicalFixture() {
  const f = fixture();
  // Exercise the actual four supplied mappings with real question titles.
  const configs = vm.runInContext(
    "JSON.parse(JSON.stringify(HISTORICAL_SOURCES))",
    f.context,
  );
  configs.forEach((c: any, i: number) => {
    c.spreadsheetId = "history-" + i;
  });
  f.context.testConfigs = configs;
  vm.runInContext(
    "HISTORICAL_SOURCES.splice(0, HISTORICAL_SOURCES.length, ...testConfigs)",
    f.context,
  );
  const add = (
    i: number,
    profiles: Record<string, string>[],
    feedback: Record<string, string>[] = [],
  ) => {
    const config = configs[i];
    const headers = [
      "Timestamp",
      ...Object.values(config.fields),
      ...Object.values(config.feedbackFields || {}),
    ] as string[];
    const sheet = new Sheet(config.sheetName);
    sheet.appendRow(headers);
    profiles.forEach((profile, row) => {
      const values: Record<string, string> = { Timestamp: "2026-08-01" };
      for (const [key, title] of Object.entries(config.fields))
        values[title as string] = profile[key] || "";
      for (const [key, title] of Object.entries(config.feedbackFields || {}))
        values[title as string] = feedback[row]?.[key] || "";
      sheet.appendRow(headers.map((h) => values[h] || ""));
    });
    f.historicalBooks.set(
      config.spreadsheetId,
      new Map([[config.sheetName, sheet]]),
    );
    return sheet;
  };
  for (let i = 0; i < 4; i++) add(i, []);
  return { ...f, add };
}
function memberObjects(f: ReturnType<typeof fixture>) {
  const [headers, ...data] = f.tabs.get("Members")!.data;
  return data.map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i]])));
}
describe("four-source historical import", () => {
  it("joins nameless sign-in and feedback by email across all sources, without events", () => {
    const f = historicalFixture();
    f.add(0, [
      {
        email_normalized: " JORDAN@EXAMPLE.COM ",
        experience_level: "Beginner",
        learning_goals: "Python",
        favorite_ice_cream: "Chocolate",
      },
    ]);
    f.add(1, [
      {
        email_normalized: "jordan@example.com",
        display_name: "Jordan Smith",
        major: "CSCE",
        dream_company: "Example Co",
      },
    ]);
    f.add(2, [
      {
        email_normalized: "jordan@example.com",
        display_name: "Jordan Smith",
        major: "STAT",
        topic_comfort: "2",
        current_goal: "Internship",
      },
    ]);
    f.add(
      3,
      [
        {
          email_normalized: "jordan@example.com",
          requested_topics: "Deployment",
        },
      ],
      [{ comprehension: "Not much", suggested_change: "More examples" }],
    );
    const summary = f.context.previewHistoricalImport();
    expect(summary[0].emailOnlyMatched).toBe(1);
    expect(summary[3].emailOnlyMatched).toBe(1);
    f.context.importHistoricalMembers();
    const [m] = memberObjects(f);
    expect(memberObjects(f)).toHaveLength(1);
    expect(m).toMatchObject({
      display_name: "Jordan Smith",
      major: "STAT",
      experience_level: "Beginner",
      topic_comfort: "2",
      requested_topics: "Deployment",
      github_enrichment_consent: "false",
    });
    expect(f.tabs.get("HistoricalResponses")!.data).toHaveLength(5);
    expect(JSON.stringify(f.tabs.get("HistoricalResponses")!.data)).toContain(
      "More examples",
    );
    expect(JSON.stringify(m)).not.toContain("Not much");
    expect(f.tabs.get("SessionSignIns")!.data).toHaveLength(1);
    expect(f.pub.size).toBe(0);
    f.context.importHistoricalMembers();
    expect(memberObjects(f)).toHaveLength(1);
    expect(f.tabs.get("HistoricalResponses")!.data).toHaveLength(5);
  });
  it("keeps unmatched history privately and merges it when that email signs in with a name", () => {
    const f = historicalFixture();
    f.add(0, [
      { email_normalized: "jordan@example.com", learning_goals: "Python" },
    ]);
    expect(f.context.previewHistoricalImport()[0].emailOnlyUnmatched).toBe(1);
    f.context.importHistoricalMembers();
    expect(memberObjects(f)).toHaveLength(0);
    expect(f.tabs.get("HistoricalResponses")!.data).toHaveLength(2);
    f.submit(2);
    expect(memberObjects(f)[0]).toMatchObject({
      display_name: "Jordan Smith",
      learning_goals: "Python",
    });
  });
  it("historical rows fill gaps without overwriting existing member answers", () => {
    const f = historicalFixture();
    f.submit(2);
    vm.runInContext(
      "upsertMember({email_normalized:'jordan@example.com',display_name:'Jordan Smith',major:'DAEN'},false)",
      f.context,
    );
    f.add(1, [
      {
        email_normalized: "jordan@example.com",
        display_name: "Old Name",
        major: "CSCE",
        dream_company: "Example",
      },
    ]);
    f.context.importHistoricalMembers();
    expect(memberObjects(f)[0]).toMatchObject({
      display_name: "Jordan Smith",
      major: "DAEN",
      dream_company: "Example",
    });
  });
  it("validates every mapping before writes and reports missing exact headers", () => {
    const f = historicalFixture();
    f.add(1, [
      { email_normalized: "jordan@example.com", display_name: "Jordan" },
    ]);
    const sheet = f.add(3, [{ email_normalized: "jordan@example.com" }]);
    sheet.data[0][1] = "Email address";
    expect(() => f.context.importHistoricalMembers()).toThrow(
      "header not found",
    );
    expect(memberObjects(f)).toHaveLength(0);
    expect(f.tabs.get("HistoricalResponses")!.data).toHaveLength(1);
    expect(f.held()).toBe(false);
  });
  it("extends the original Members schema without changing data", () => {
    const f = fixture();
    const sheet = f.tabs.get("Members")!;
    sheet.data[0] = sheet.data[0].slice(0, 18);
    sheet.data.push(["permanent-id", "jordan@example.com", "Jordan"]);
    vm.runInContext(
      "ensureTab(SpreadsheetApp.getActive(),'Members',HEADERS.Members)",
      f.context,
    );
    expect(sheet.data[0]).toContain("learning_goals");
    expect(sheet.data[1]).toEqual([
      "permanent-id",
      "jordan@example.com",
      "Jordan",
    ]);
  });
});
