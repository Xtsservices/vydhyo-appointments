exports.parseFlexibleDate = (dateStr) => {
  if (!dateStr) return null;

  // Try YYYY-MM-DD
  let parts = dateStr.split('-');
  if (parts.length === 3) {
    if (parts[0].length === 4) {
      // Format: YYYY-MM-DD
      return new Date(`${parts[0]}-${parts[1]}-${parts[2]}`);
    } else {
      // Format: DD-MM-YYYY
      return new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
    }
  }

  // fallback
  const parsed = new Date(dateStr);
  return isNaN(parsed.getTime()) ? null : parsed;
}


exports.sortSlotsByTime = (slots) => {
  return slots.sort((a, b) => {
    const [aHour, aMin] = a.time.split(':').map(Number);
    const [bHour, bMin] = b.time.split(':').map(Number);
    return aHour !== bHour ? aHour - bHour : aMin - bMin;
  });
}