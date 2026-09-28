'use strict';

function calculatePlayback(hoursInput, minutesInput, speedInput) {
  const integer = (value, label, min, max) => {
    const text = String(value).trim();
    if (text === '') throw new Error(label + '을 입력해 주세요.');
    if (!/^\d+$/.test(text)) throw new Error(label + '은 정수로 입력해 주세요.');
    const number = Number(text);
    if (!Number.isSafeInteger(number) || number < min || number > max) {
      throw new Error(label + '은 ' + min + '~' + max + ' 범위로 입력해 주세요.');
    }
    return number;
  };
  const decimal = (value, label, min, max) => {
    const text = String(value).trim();
    if (text === '') throw new Error(label + '을 입력해 주세요.');
    if (!/^\d+(?:\.\d+)?$/.test(text)) throw new Error(label + '은 숫자로 입력해 주세요.');
    const number = Number(text);
    if (!Number.isFinite(number) || number < min || number > max) {
      throw new Error(label + '은 ' + min + '~' + max + ' 범위로 입력해 주세요.');
    }
    return number;
  };

  const hours = integer(hoursInput, '영상 시간', 0, 999);
  const minutes = integer(minutesInput, '영상 분', 0, 59);
  const speed = decimal(speedInput, '재생 배속', 0.25, 4);
  const originalSeconds = (hours * 60 + minutes) * 60;
  if (originalSeconds === 0) throw new Error('영상 길이는 1분 이상이어야 합니다.');
  const watchSeconds = Math.round(originalSeconds / speed);
  return {
    originalSeconds,
    watchSeconds,
    differenceSeconds: Math.abs(originalSeconds - watchSeconds),
    direction: speed === 1 ? 'same' : speed > 1 ? 'saved' : 'added',
    speed
  };
}

function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remains = seconds % 60;
  const parts = [];
  if (hours) parts.push(hours + '시간');
  if (minutes) parts.push(minutes + '분');
  if (remains || parts.length === 0) parts.push(remains + '초');
  return parts.join(' ');
}

if (typeof module !== 'undefined') module.exports = {calculatePlayback, formatDuration};
