function formatDisplayDate(isoDate) {
  const [year, month, day] = isoDate.split("-");
  return `${month}/${day}/${year}`;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function monthLabel(year, month) {
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

function startWeekday(year, month) {
  return new Date(year, month - 1, 1).getDay();
}

function shiftMonth(year, month, delta) {
  const d = new Date(year, month - 1 + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

function monthKey(year, month) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

module.exports = {
  formatDisplayDate,
  monthLabel,
  daysInMonth,
  startWeekday,
  shiftMonth,
  monthKey,
};
