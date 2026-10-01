const { PermissionFlagsBits } = require("discord.js");
const {
  MAX_PER_GROUP, MAX_ROLES,
  hasElevatedPermission, checkAssignable, groupForModal, checkCapacity, reconcileRoles,
} = require("../../utils/selfRoles/logic");
const { buildRolesModal, readSubmittedRoleIds } = require("../../utils/selfRoles/modal");

const GUILD = "100";
const entry = (roleId, category = null, description = null) => ({ roleId, category, description });
const role = (overrides = {}) => ({ id: "200", managed: false, position: 5, permissions: 0n, ...overrides });
const ctx = (overrides = {}) => ({ role: role(), guildId: GUILD, botTopPosition: 10, invokerTopPosition: null, protectedRoleIds: ["900", "901"], ...overrides });

describe("checkAssignable", () => {
  test("accepts an ordinary role below the bot", () => {
    expect(checkAssignable(ctx())).toBeNull();
  });

  test.each([
    ["everyone", { role: role({ id: GUILD }) }],
    ["managed", { role: role({ managed: true }) }],
    ["protected", { role: role({ id: "900" }) }],
    ["elevated", { role: role({ permissions: PermissionFlagsBits.KickMembers }) }],
    ["above_bot", { role: role({ position: 10 }) }],
    ["above_invoker", { invokerTopPosition: 5 }],
  ])("refuses with %s", (reason, overrides) => {
    expect(checkAssignable(ctx(overrides))).toBe(reason);
  });

  test("a protected role is refused as protected even when it has no permissions", () => {
    expect(checkAssignable(ctx({ role: role({ id: "901", permissions: 0n }) }))).toBe("protected");
  });

  test("the guild owner is not bound by their own rank", () => {
    expect(checkAssignable(ctx({ role: role({ position: 9 }), invokerTopPosition: null }))).toBeNull();
  });
});

describe("hasElevatedPermission", () => {
  test("ignores cosmetic permissions", () => {
    expect(hasElevatedPermission(PermissionFlagsBits.SendMessages | PermissionFlagsBits.AttachFiles)).toBe(false);
  });

  test("catches a dangerous bit mixed in with harmless ones", () => {
    expect(hasElevatedPermission(PermissionFlagsBits.SendMessages | PermissionFlagsBits.Administrator)).toBe(true);
  });

  test("accepts a bitfield passed as a string", () => {
    expect(hasElevatedPermission(String(PermissionFlagsBits.BanMembers))).toBe(true);
  });
});

describe("groupForModal", () => {
  test("named categories keep first-seen order and merge case-insensitively", () => {
    const groups = groupForModal([entry("1", "Games"), entry("2", "Pings"), entry("3", "games")]);
    expect(groups.map(g => g.label)).toEqual(["Games", "Pings"]);
    expect(groups[0].entries.map(e => e.roleId)).toEqual(["1", "3"]);
  });

  test("uncategorized roles fill one default group up to the limit", () => {
    const groups = groupForModal(Array.from({ length: MAX_PER_GROUP }, (_, i) => entry(String(i))));
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("Roles");
  });

  test("uncategorized roles past the limit spill into numbered groups", () => {
    const groups = groupForModal(Array.from({ length: MAX_PER_GROUP + 1 }, (_, i) => entry(String(i))));
    expect(groups.map(g => g.label)).toEqual(["Roles (1)", "Roles (2)"]);
    expect(groups[1].entries).toHaveLength(1);
  });

  test("an empty list yields no groups", () => {
    expect(groupForModal([])).toEqual([]);
  });
});

describe("checkCapacity", () => {
  const fill = (n, category = null) => Array.from({ length: n }, (_, i) => entry(`r${i}`, category));

  test("accepts a role that fits", () => {
    expect(checkCapacity(fill(3), entry("new"))).toBeNull();
  });

  test("refuses the role past the overall cap", () => {
    expect(checkCapacity(fill(MAX_ROLES), entry("new"))).toBe("full");
  });

  test("refuses an eleventh role in one category", () => {
    expect(checkCapacity(fill(MAX_PER_GROUP, "Games"), entry("new", "Games"))).toBe("category_full");
  });

  test("refuses a sixth group", () => {
    const five = ["A", "B", "C", "D", "E"].map((c, i) => entry(`r${i}`, c));
    expect(checkCapacity(five, entry("new", "F"))).toBe("too_many_groups");
  });

  test("updating a listed role does not count it twice", () => {
    const full = fill(MAX_ROLES);
    expect(checkCapacity(full, entry("r0", null, "new description"))).toBeNull();
  });
});

describe("reconcileRoles", () => {
  const LISTED = ["halo", "minecraft", "l4d2"];

  test("adds checked roles and removes unchecked ones", () => {
    const r = reconcileRoles(["halo"], ["minecraft"], LISTED);
    expect(r.added).toEqual(["minecraft"]);
    expect(r.removed).toEqual(["halo"]);
    expect([...r.finalIds].sort()).toEqual(["minecraft"]);
  });

  test("never touches roles that are not on the list", () => {
    const r = reconcileRoles(["peasant", "moderator", "halo"], [], LISTED);
    expect(r.removed).toEqual(["halo"]);
    expect([...r.finalIds].sort()).toEqual(["moderator", "peasant"]);
  });

  test("drops submitted IDs that are not on the list", () => {
    const r = reconcileRoles([], ["halo", "admin"], LISTED);
    expect(r.added).toEqual(["halo"]);
    expect(r.finalIds).not.toContain("admin");
  });

  test("reports no change when the form matches the member", () => {
    const r = reconcileRoles(["peasant", "halo"], ["halo"], LISTED);
    expect(r.added).toEqual([]);
    expect(r.removed).toEqual([]);
  });

  test("ignores a duplicated submission", () => {
    const r = reconcileRoles([], ["halo", "halo"], LISTED);
    expect(r.added).toEqual(["halo"]);
    expect(r.finalIds.filter(id => id === "halo")).toHaveLength(1);
  });
});

describe("buildRolesModal", () => {
  const groups = groupForModal([entry("1", "Games", "Friday nights"), entry("2", "Games"), entry("3")]);
  const names = new Map([["1", "Halo"], ["2", "Minecraft"], ["3", "Movie Night"]]);
  const json = buildRolesModal("roles:1", groups, names, new Set(["2"])).toJSON();
  const groupsJson = json.components.map(c => c.component);

  test("every group can be left fully unchecked", () => {
    for (const group of groupsJson) {
      expect(group.min_values).toBe(0);
      expect(group.required).toBe(false);
    }
  });

  test("roles the member holds start checked", () => {
    const [halo, minecraft] = groupsJson[0].options;
    expect(halo.default).toBe(false);
    expect(minecraft.default).toBe(true);
  });

  test("uses the live role name and the stored description", () => {
    expect(groupsJson[0].options[0]).toMatchObject({ label: "Halo", value: "1", description: "Friday nights" });
    expect(groupsJson[0].options[1].description).toBeUndefined();
  });

  test("one labelled component per group", () => {
    expect(json.components.map(c => c.label)).toEqual(["Games", "Roles"]);
  });
});

describe("readSubmittedRoleIds", () => {
  test("flattens every group and tolerates a missing one", () => {
    const submit = { fields: { fields: new Map([["group:0", { values: ["1", "2"] }], ["group:2", { values: ["5"] }]]) } };
    expect(readSubmittedRoleIds(submit, 3)).toEqual(["1", "2", "5"]);
  });
});
