export const catalogUrl = "https://videos.recordly.dev/api/billing/catalog";

export function parseCatalog(value) {
  const price = value?.prices?.find((entry) => entry.interval === "monthly" && entry.currency === "usd");
  const limits = value?.limits;
  if (!price || !Number.isSafeInteger(price.unitAmount) || price.unitAmount <= 0 ||
      !limits || ![limits.freeRecordingLimit, limits.freeMaxRecordingBytes, limits.plusMaxRecordingBytes].every((n) => Number.isSafeInteger(n) && n > 0) ||
      limits.plusMaxRecordingBytes < limits.freeMaxRecordingBytes ||
      (limits.storageLimitBytes !== null && (!Number.isSafeInteger(limits.storageLimitBytes) || limits.storageLimitBytes <= 0))) {
    throw new Error("Pricing is temporarily unavailable.");
  }
  const regular = Number.isSafeInteger(price.regularUnitAmount) && price.regularUnitAmount > price.unitAmount ? price.regularUnitAmount : null;
  return {
    amount: price.unitAmount,
    regular: regular && price.promotion === "early_bird" ? regular : null,
    freeRecordings: limits.freeRecordingLimit,
    freeBytes: limits.freeMaxRecordingBytes,
    cloudBytes: limits.plusMaxRecordingBytes,
    storageBytes: limits.storageLimitBytes,
    weeklyUploads: Number.isSafeInteger(limits.plusWeeklyUploadLimit) && limits.plusWeeklyUploadLimit > 0 ? limits.plusWeeklyUploadLimit : null,
  };
}

export const dollars = (cents) => new Intl.NumberFormat("en-US", {style:"currency",currency:"USD",minimumFractionDigits:cents % 100 ? 2 : 0,maximumFractionDigits:2}).format(cents / 100);
export const gigabytes = (bytes) => `${new Intl.NumberFormat("en-US",{maximumFractionDigits:1}).format(bytes / 1e9)} GB`;

export function pricingMetadata(origin) {
  const canonical = `${origin}/pricing`;
  const title = "Pricing | Recordly";
  const description = "Record and edit for free. Compare Recordly Free and Cloud, with current monthly pricing and sharing limits.";
  return {title, description, canonical, image:null, post:null, robots:"index, follow", structuredData:{"@context":"https://schema.org","@type":"WebPage",name:"Recordly pricing",description,url:canonical}};
}
