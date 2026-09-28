'use strict';

function calculateDiscount(priceInput, firstInput, secondInput, couponInput) {
  const number = (value, label, options = {}) => {
    const text = String(value).trim();
    if (text === '') throw new Error(label + '을 입력해 주세요.');
    if (!/^\d+(?:\.\d+)?$/.test(text)) throw new Error(label + '은 숫자로 입력해 주세요.');
    const valueNumber = Number(text);
    if (!Number.isFinite(valueNumber)) throw new Error(label + '이 너무 큽니다.');
    if (valueNumber < (options.min ?? 0) || valueNumber > options.max) {
      throw new Error(label + '은 ' + (options.min ?? 0).toLocaleString('ko-KR') + '~' + options.max.toLocaleString('ko-KR') + ' 범위로 입력해 주세요.');
    }
    return valueNumber;
  };

  const price = number(priceInput, '원래 가격', {min: 1, max: 1000000000});
  const first = number(firstInput, '첫 번째 할인율', {min: 0, max: 100});
  const second = number(secondInput, '두 번째 할인율', {min: 0, max: 100});
  const coupon = number(couponInput, '쿠폰 금액', {min: 0, max: 1000000000});

  const afterFirstExact = price * (1 - first / 100);
  const afterSecondExact = afterFirstExact * (1 - second / 100);
  const finalExact = Math.max(0, afterSecondExact - coupon);
  const finalPrice = Math.round(finalExact);
  const saved = Math.round(price - finalExact);

  return {
    price: Math.round(price),
    afterFirst: Math.round(afterFirstExact),
    afterSecond: Math.round(afterSecondExact),
    finalPrice,
    saved,
    effectiveRate: (price - finalExact) / price * 100,
    couponApplied: Math.min(coupon, afterSecondExact),
    couponLimited: coupon > afterSecondExact
  };
}

if (typeof module !== 'undefined') module.exports = {calculateDiscount};
