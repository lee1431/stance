'use strict';
function fitSize(width, height, target, axis) {
  const parse = (v, label) => {
    if (!/^\d+$/.test(String(v).trim())) throw new Error(label + '에 1~100,000 사이 정수를 입력해 주세요.');
    const n = Number(v);
    if (!Number.isSafeInteger(n) || n < 1 || n > 100000) throw new Error(label + '에 1~100,000 사이 정수를 입력해 주세요.');
    return n;
  };
  const w = parse(width, '원본 가로'), h = parse(height, '원본 세로'), t = parse(target, '목표 크기');
  if (!['width', 'height'].includes(axis)) throw new Error('기준 방향을 선택해 주세요.');
  const scale = t / (axis === 'width' ? w : h);
  const rawW = axis === 'width' ? t : w * scale;
  const rawH = axis === 'height' ? t : h * scale;
  const nw = Math.round(rawW), nh = Math.round(rawH);
  if (nw < 1 || nh < 1 || nw > 100000 || nh > 100000) throw new Error('결과가 1~100,000px 범위를 벗어납니다. 목표 크기를 조정해 주세요.');
  let a = w, b = h;
  while (b) [a, b] = [b, a % b];
  return {width:nw, height:nh, ratio: (w/a) + ':' + (h/a), percent:scale*100, rounded:Math.abs(rawW-nw)>1e-8 || Math.abs(rawH-nh)>1e-8};
}
if (typeof module !== 'undefined') module.exports = {fitSize};
