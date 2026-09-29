"use strict";

const STORAGE_KEY = "stance-team-shuffle-settings-v1";
const sampleNames = ["민준", "서연", "도윤", "지우", "하준", "수아", "현우", "유나"];

const namesInput = document.querySelector("#names");
const teamCountInput = document.querySelector("#team-count");
const rememberInput = document.querySelector("#remember");
const countOutput = document.querySelector("#participant-count");
const errorOutput = document.querySelector("#error");
const result = document.querySelector("#result");
const emptyState = document.querySelector("#empty-state");
const copyButton = document.querySelector("#copy-result");
const shuffleButton = document.querySelector("#shuffle");
let currentTeams = [];

function readForm() {
  return {
    names: TeamShuffle.parseNames(namesInput.value),
    teamCount: Number(teamCountInput.value),
  };
}

function updateCount() {
  countOutput.textContent = `${TeamShuffle.parseNames(namesInput.value).length}명`;
}

function clearResult(message = "참가자를 입력하고 팀 나누기를 눌러 주세요.") {
  currentTeams = [];
  result.replaceChildren();
  emptyState.textContent = message;
  emptyState.hidden = false;
  copyButton.disabled = true;
}

function saveSettings() {
  try {
    if (!rememberInput.checked) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      names: namesInput.value,
      teamCount: teamCountInput.value,
      remember: true,
    }));
  } catch (_) {
    errorOutput.textContent = "이 브라우저에서는 입력 내용을 저장할 수 없습니다.";
  }
}

function renderTeams() {
  const { names, teamCount } = readForm();
  const outcome = TeamShuffle.makeTeams(names, teamCount);
  errorOutput.textContent = outcome.error;
  if (outcome.error) {
    clearResult("입력 내용을 확인하면 결과가 여기에 표시됩니다.");
    return;
  }

  currentTeams = outcome.teams;
  result.replaceChildren(...currentTeams.map((members, index) => {
    const card = document.createElement("article");
    card.className = "team-card";
    const title = document.createElement("h3");
    title.textContent = `${index + 1}팀`;
    const badge = document.createElement("span");
    badge.textContent = `${members.length}명`;
    title.append(badge);
    const list = document.createElement("ol");
    members.forEach((name) => {
      const item = document.createElement("li");
      item.textContent = name;
      list.append(item);
    });
    card.append(title, list);
    return card;
  }));
  emptyState.hidden = true;
  copyButton.disabled = false;
  saveSettings();
}

function invalidate() {
  updateCount();
  errorOutput.textContent = "";
  clearResult("변경된 참가자로 다시 팀을 나눠 주세요.");
  saveSettings();
}

shuffleButton.addEventListener("click", renderTeams);
document.querySelector("#reshuffle").addEventListener("click", renderTeams);
document.querySelector("#sample").addEventListener("click", () => {
  namesInput.value = sampleNames.join("\n");
  teamCountInput.value = "3";
  updateCount();
  renderTeams();
});
document.querySelector("#clear").addEventListener("click", () => {
  namesInput.value = "";
  teamCountInput.value = "2";
  updateCount();
  errorOutput.textContent = "";
  clearResult();
  saveSettings();
  namesInput.focus();
});
copyButton.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(TeamShuffle.formatTeams(currentTeams));
    copyButton.textContent = "복사했어요";
    setTimeout(() => { copyButton.textContent = "결과 복사"; }, 1400);
  } catch (_) {
    errorOutput.textContent = "복사하지 못했습니다. 브라우저 권한을 확인해 주세요.";
  }
});
namesInput.addEventListener("input", invalidate);
teamCountInput.addEventListener("input", invalidate);
rememberInput.addEventListener("change", saveSettings);

try {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
  if (saved && saved.remember) {
    namesInput.value = saved.names || "";
    teamCountInput.value = saved.teamCount || "2";
    rememberInput.checked = true;
    updateCount();
    if (TeamShuffle.parseNames(namesInput.value).length >= 2) renderTeams();
  }
} catch (_) {
  localStorage.removeItem(STORAGE_KEY);
}

updateCount();
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
}
