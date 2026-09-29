(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.TeamShuffle = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function parseNames(text) {
    return String(text || "")
      .split(/\r?\n/)
      .map((name) => name.trim())
      .filter(Boolean);
  }

  function validate(names, teamCount) {
    if (names.length < 2) return "참가자를 두 명 이상 입력해 주세요.";
    if (!Number.isInteger(teamCount) || teamCount < 2 || teamCount > 10) {
      return "팀 수는 2에서 10 사이의 정수여야 합니다.";
    }
    if (teamCount > names.length) return "팀 수는 참가자 수보다 많을 수 없습니다.";
    const seen = new Set();
    const duplicates = [];
    names.forEach((name) => {
      const key = name.toLocaleLowerCase("ko-KR");
      if (seen.has(key) && !duplicates.includes(name)) duplicates.push(name);
      seen.add(key);
    });
    if (duplicates.length) return `중복된 이름을 확인해 주세요: ${duplicates.join(", ")}`;
    return "";
  }

  function secureRandomInt(max) {
    if (!Number.isInteger(max) || max <= 0) throw new RangeError("max must be a positive integer");
    const cryptoApi = globalThis.crypto;
    if (!cryptoApi || typeof cryptoApi.getRandomValues !== "function") {
      throw new Error("이 브라우저에서는 안전한 무작위 섞기를 사용할 수 없습니다.");
    }
    const limit = Math.floor(0x100000000 / max) * max;
    const data = new Uint32Array(1);
    do cryptoApi.getRandomValues(data); while (data[0] >= limit);
    return data[0] % max;
  }

  function shuffle(names, randomInt = secureRandomInt) {
    const result = names.slice();
    for (let i = result.length - 1; i > 0; i -= 1) {
      const j = randomInt(i + 1);
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  function makeTeams(names, teamCount, randomInt) {
    const error = validate(names, teamCount);
    if (error) return { error, teams: [] };
    const teams = Array.from({ length: teamCount }, () => []);
    shuffle(names, randomInt).forEach((name, index) => teams[index % teamCount].push(name));
    return { error: "", teams };
  }

  function formatTeams(teams) {
    return teams.map((members, index) => `${index + 1}팀\n${members.map((name) => `- ${name}`).join("\n")}`).join("\n\n");
  }

  return { parseNames, validate, shuffle, makeTeams, formatTeams };
});
