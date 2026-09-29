(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.SellerMargin = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function parseNumber(value) {
    const text = String(value ?? "").replace(/,/g, "").trim();
    if (!text) return NaN;
    return Number(text);
  }

  function validate(input) {
    const fields = ["price", "cost", "platformFee", "paymentFee", "shipping", "other"];
    if (fields.some((key) => !Number.isFinite(input[key]))) return "모든 항목을 숫자로 입력해 주세요.";
    if (input.price <= 0) return "판매가는 0원보다 커야 합니다.";
    if ([input.cost, input.shipping, input.other].some((value) => value < 0)) return "비용은 0원 이상이어야 합니다.";
    if ([input.price, input.cost, input.shipping, input.other].some((value) => value > 1000000000)) return "금액은 10억원 이하로 입력해 주세요.";
    if ([input.platformFee, input.paymentFee].some((value) => value < 0 || value > 100)) return "수수료율은 각각 0~100% 사이여야 합니다.";
    if (input.platformFee + input.paymentFee >= 100) return "전체 수수료율은 100%보다 작아야 합니다.";
    return "";
  }

  function calculate(input) {
    const error = validate(input);
    if (error) return { ok: false, error };
    const feeRate = input.platformFee + input.paymentFee;
    const feeAmount = input.price * feeRate / 100;
    const settlement = input.price - feeAmount - input.shipping - input.other;
    const profit = settlement - input.cost;
    const marginRate = profit / input.price * 100;
    const markupRate = input.cost > 0 ? profit / input.cost * 100 : null;
    const breakEven = Math.ceil((input.cost + input.shipping + input.other) / (1 - feeRate / 100));
    return { ok: true, feeRate, feeAmount, settlement, profit, marginRate, markupRate, breakEven };
  }

  function formatWon(value) {
    return `${Math.round(value).toLocaleString("ko-KR")}원`;
  }

  return { parseNumber, validate, calculate, formatWon };
});
