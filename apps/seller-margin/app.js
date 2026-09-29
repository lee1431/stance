"use strict";

const STORAGE_KEY = "stance-seller-margin-v1";
const ids = ["price", "cost", "platform-fee", "payment-fee", "shipping", "other"];
const inputs = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));
const remember = document.getElementById("remember");
const error = document.getElementById("error");
const empty = document.getElementById("empty");
const result = document.getElementById("result");
const copyButton = document.getElementById("copy");
let latest = null;

function readInput() {
  return {
    price: SellerMargin.parseNumber(inputs.price.value),
    cost: SellerMargin.parseNumber(inputs.cost.value),
    platformFee: SellerMargin.parseNumber(inputs["platform-fee"].value),
    paymentFee: SellerMargin.parseNumber(inputs["payment-fee"].value),
    shipping: SellerMargin.parseNumber(inputs.shipping.value),
    other: SellerMargin.parseNumber(inputs.other.value),
  };
}

function persist() {
  try {
    if (!remember.checked) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    const values = Object.fromEntries(ids.map((id) => [id, inputs[id].value]));
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ remember: true, values }));
  } catch (_) {
    error.textContent = "이 브라우저에서는 입력값을 저장할 수 없습니다.";
  }
}

function clearResult(message = "판매 조건을 입력하면 결과가 여기에 표시됩니다.") {
  latest = null;
  empty.querySelector("p").textContent = message;
  empty.hidden = false;
  result.hidden = true;
  copyButton.disabled = true;
}

function setText(id, value) {
  document.getElementById(id).textContent = value;
}

function calculate() {
  const input = readInput();
  const output = SellerMargin.calculate(input);
  if (!output.ok) {
    error.textContent = output.error;
    clearResult("입력 내용을 확인하면 계산 결과가 표시됩니다.");
    return;
  }

  latest = { input, output };
  error.textContent = "";
  setText("profit", SellerMargin.formatWon(output.profit));
  setText("margin-rate", `${output.marginRate.toFixed(2)}%`);
  setText("settlement", SellerMargin.formatWon(output.settlement));
  setText("fee-amount", SellerMargin.formatWon(output.feeAmount));
  setText("fee-rate", `${output.feeRate.toFixed(2).replace(/\.00$/, "")}%`);
  setText("break-even", SellerMargin.formatWon(output.breakEven));
  setText("markup-rate", output.markupRate === null ? "원가 0원" : `${output.markupRate.toFixed(2)}%`);
  const status = document.getElementById("status");
  status.textContent = output.profit > 0 ? "이 조건은 흑자입니다." : output.profit < 0 ? "이 조건은 적자입니다." : "손익분기점입니다.";
  status.className = output.profit > 0 ? "positive" : output.profit < 0 ? "negative" : "neutral";
  empty.hidden = true;
  result.hidden = false;
  copyButton.disabled = false;
  persist();
}

document.getElementById("form").addEventListener("submit", (event) => {
  event.preventDefault();
  calculate();
});

document.getElementById("sample").addEventListener("click", () => {
  const values = { price: "30000", cost: "12000", "platform-fee": "10", "payment-fee": "3", shipping: "3500", other: "500" };
  ids.forEach((id) => { inputs[id].value = values[id]; });
  calculate();
});

document.getElementById("clear").addEventListener("click", () => {
  ids.forEach((id) => { inputs[id].value = id.includes("fee") ? "0" : ""; });
  error.textContent = "";
  clearResult();
  persist();
  inputs.price.focus();
});

ids.forEach((id) => inputs[id].addEventListener("input", () => {
  error.textContent = "";
  clearResult("변경한 조건으로 다시 계산해 주세요.");
  persist();
}));

remember.addEventListener("change", persist);

copyButton.addEventListener("click", async () => {
  if (!latest) return;
  const { input, output } = latest;
  const text = [
    `판매가 ${SellerMargin.formatWon(input.price)}`,
    `예상 순이익 ${SellerMargin.formatWon(output.profit)} (마진율 ${output.marginRate.toFixed(2)}%)`,
    `예상 정산액 ${SellerMargin.formatWon(output.settlement)}`,
    `수수료 ${SellerMargin.formatWon(output.feeAmount)} (${output.feeRate.toFixed(2)}%)`,
    `손익분기 판매가 ${SellerMargin.formatWon(output.breakEven)}`,
  ].join("\n");
  try {
    await navigator.clipboard.writeText(text);
    copyButton.textContent = "복사했어요";
    setTimeout(() => { copyButton.textContent = "결과 복사"; }, 1400);
  } catch (_) {
    error.textContent = "결과를 복사하지 못했습니다. 브라우저 권한을 확인해 주세요.";
  }
});

try {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
  if (saved && saved.remember && saved.values) {
    ids.forEach((id) => { inputs[id].value = saved.values[id] ?? ""; });
    remember.checked = true;
    calculate();
  }
} catch (_) {
  localStorage.removeItem(STORAGE_KEY);
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
}
