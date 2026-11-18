/* DDSM: one 13-digit master waybill, optional three-digit package suffix.
 * Extract only a complete valid 13/16 digit value, never a fuzzy prefix.
 */
(function(root) {
  'use strict';
  function parse(raw) {
    const scanned = String(raw == null ? '' : raw).trim();
    const digits = scanned.replace(/[\s\-]/g, '');
    if (!/^(?:\d{13}|\d{16})$/.test(digits)) {
      return {scanned, master: null, suffix: null, lookup: scanned, valid: false};
    }
    return {
      scanned, master: digits.slice(0, 13),
      suffix: digits.length === 16 ? digits.slice(13) : null,
      lookup: digits.slice(0, 13), valid: true
    };
  }
  root.DDSM_Waybill = Object.freeze({parse});
})(typeof window !== 'undefined' ? window : globalThis);
