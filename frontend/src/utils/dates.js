/**
 * Location-agnostic calendar date helpers anchored on Temporal.PlainDate
 * (falling back cleanly to pure ISO-8601 calendar arithmetic when Temporal is absent,
 * avoiding `new Date("YYYY-MM-DD")` UTC-offset drift or `formatToParts()` hacks).
 */

const MONTH_NAMES_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

function pad2(n) {
  return String(n).padStart(2, '0');
}

function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year, month) {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function parseIsoComponents(isoStr) {
  if (!isoStr || typeof isoStr !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoStr.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    return null;
  }
  return { year, month, day };
}

function addDaysIsoFallback(isoStr, deltaDays) {
  const parts = parseIsoComponents(isoStr);
  if (!parts) return isoStr;
  let { year, month, day } = parts;
  let remaining = Math.trunc(deltaDays);

  while (remaining > 0) {
    const dim = daysInMonth(year, month);
    if (day + remaining <= dim) {
      day += remaining;
      remaining = 0;
    } else {
      remaining -= dim - day + 1;
      day = 1;
      month += 1;
      if (month > 12) {
        month = 1;
        year += 1;
      }
    }
  }

  while (remaining < 0) {
    if (day + remaining >= 1) {
      day += remaining;
      remaining = 0;
    } else {
      remaining += day;
      month -= 1;
      if (month < 1) {
        month = 12;
        year -= 1;
      }
      day = daysInMonth(year, month);
    }
  }

  return `${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(day)}`;
}

export function todayPlainDateISO(ianaTimezone) {
  if (typeof globalThis.Temporal?.Now?.plainDateISO === 'function') {
    try {
      return ianaTimezone
        ? globalThis.Temporal.Now.plainDateISO(ianaTimezone).toString()
        : globalThis.Temporal.Now.plainDateISO().toString();
    } catch {
      return globalThis.Temporal.Now.plainDateISO().toString();
    }
  }

  // Fallback for browsers without native Temporal (e.g. Safari)
  try {
    return new Intl.DateTimeFormat('en-CA', {
      ...(ianaTimezone ? { timeZone: ianaTimezone } : {}),
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  } catch {
    return new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  }
}

export function offsetPlainDateISO(isoDateStr, deltaDays) {
  if (!isoDateStr) return '';
  if (typeof globalThis.Temporal?.PlainDate?.from === 'function') {
    try {
      const plain = globalThis.Temporal.PlainDate.from(isoDateStr);
      const shifted =
        deltaDays >= 0
          ? plain.add({ days: deltaDays })
          : plain.subtract({ days: Math.abs(deltaDays) });
      return shifted.toString();
    } catch {
      return addDaysIsoFallback(isoDateStr, deltaDays);
    }
  }
  return addDaysIsoFallback(isoDateStr, deltaDays);
}

export function formatPlainDateShort(isoDateStr) {
  if (!isoDateStr) return '—';
  if (typeof globalThis.Temporal?.PlainDate?.from === 'function') {
    try {
      const p = globalThis.Temporal.PlainDate.from(isoDateStr);
      return `${MONTH_NAMES_SHORT[p.month - 1]} ${pad2(p.day)}`;
    } catch {
      // Fallback below
    }
  }
  const c = parseIsoComponents(isoDateStr);
  if (!c) return isoDateStr;
  return `${MONTH_NAMES_SHORT[c.month - 1]} ${pad2(c.day)}`;
}

