/* DDSM: exact 13-digit master plus optional three-digit package suffix.
 * Normalize only known scanner framing and separators; never guess missing digits.
 */
(function(root) {
  'use strict';
  function parse(raw) {
    const scanned=String(raw==null?'':raw).trim();
    let payload=scanned.replace(/^[\x00-\x1f\x7f\ufeff]+|[\x00-\x1f\x7f\ufeff]+$/g,'').trim();
    // AIM symbology identifiers commonly added by hardware or barcode decoders.
    payload=payload.replace(/^\](?:C[01]|A[01]|I0|E[04])/,'');
    payload=payload.replace(/^[\x00-\x1f\x7f\ufeff]+|[\x00-\x1f\x7f\ufeff]+$/g,'');
    const digits=payload.replace(/[\uff10-\uff19]/g,c=>String(c.charCodeAt(0)-0xff10)).replace(/[\s-]/g,'');
    if(!/^(?:[0-9]{13}|[0-9]{16})$/.test(digits)){
      return {scanned, digits, master:null,suffix:null,lookup:scanned,valid:false};
    }
    return {scanned,digits,master:digits.slice(0,13),suffix:digits.length===16?digits.slice(13):null,lookup:digits.slice(0,13),valid:true};
  }
  root.DDSM_Waybill=Object.freeze({parse});
})(typeof window!=='undefined'?window:globalThis);
