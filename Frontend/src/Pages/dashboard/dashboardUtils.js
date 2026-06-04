export const formatDate = (dateStr) => {
  if (!dateStr) return "N/A";
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};

export const normalizeJob = (item, index) => ({
  id: item.id || index,
  title: item.title,
  company: item.company,
  link: item.link,
  location: item.location,
  expiry: item.expiry ? formatDate(item.expiry) : "N/A",
  match: item.match || 0,
  strong_skills: item.strong_skills || [],
  weak_skills: item.weak_skills || [],
  missing_skills: item.missing_skills || [],
  summary: item.summary || "",
  interview_probability: item.interview_probability || "low",
});

export const startFakeProgress = (setProgress) => {
  let val = 20;
  const interval = setInterval(() => {
    if (val < 35) val += Math.random() * 3;
    else if (val < 55) val += Math.random() * 1.8;
    else if (val < 75) val += Math.random() * 1.2;
    else if (val < 90) val += Math.random() * 0.5;
    else if (val < 95) val += Math.random() * 0.15;
    if (val > 95) val = 95;
    setProgress(prev => val > prev ? Math.floor(val) : prev);
  }, 800);
  return interval;
};
