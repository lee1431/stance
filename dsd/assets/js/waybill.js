/* DSD freight label parser: 13-digit master waybill + optional 3-digit item index.
 * Never discard the scanned barcode: preserve item identity for future scan logs.
 */
(function(root){
  'use strict';
  function parse(raw){
    const scanned=String(raw??'').trim();
    const digits=scanned.replace(/[\s-]/g,'');
    if (!/^(?:[0-9]{13}|[0-9]{16})$/.test(digits)) {
      return Object.freeze({scanned,lookup:scanned,master_digits:null,item_suffix:null,kind:'other'});
    }
    const master=digits.slice(0,13);
    const item=digits.length===16?digits.slice(13):null;
    // Prefer the exact visual master prefix when the barcode contains
    // original hyphens; otherwise use 13 raw digits for the server lookup.
    const lookup=item
      ? scanned.replace(/[0-9]{3}\s*$/,'').replace(/[\s-]+$/,'')
      : scanned;
    return Object.freeze({
      scanned,lookup,master_digits:master,item_suffix:item,
      kind:item?'item':'master'
    });
  }
  root.DSDWaybill=Object.freeze({parse});
})(typeof window!=='undefined'?window:globalThis);
