// Risk scoring helpers for UsageMonitoringPlus
// Keep logic centralized to avoid divergence across components

function isPositiveNumber(n) {
  return typeof n === 'number' && isFinite(n) && n > 0
}

function safeRatio(value, threshold) {
  if (!isPositiveNumber(threshold)) return 0
  const v = Number(value) || 0
  return v / threshold
}

function clamp(num, min, max) {
  return Math.max(min, Math.min(max, num))
}

export function computeIpRisk(row, thresholds) {
  // 强化短时爆发敏感度：提升 1h 权重，适度下调 6h/12h
  const h6Score = clamp(Math.round(safeRatio(row.distinctVideosH6, thresholds.ip6h) * 25), 0, 100)
  const h12Score = clamp(Math.round(safeRatio(row.distinctVideosH12, thresholds.ip12h) * 20), 0, 100)
  const distinctScore = clamp(Math.round(safeRatio(row.distinctVideosH1, thresholds.ipVid1h) * 35), 0, 100)
  const uaScore = clamp(Math.round((Number(row.uaDiversity) || 0) * 1.5), 0, 100)
  const total = clamp(Math.round(h6Score + h12Score + distinctScore + uaScore), 0, 100)
  return total
}

export function computeUserRisk(u, thresholds) {
  // 强化短时爆发敏感度：提升 1h 权重，适度下调 6h/12h
  const h6Score = clamp(Math.round(safeRatio(u.distinctVideosH6, thresholds.user6h) * 35), 0, 100)
  const h12Score = clamp(Math.round(safeRatio(u.distinctVideosH12, thresholds.user12h) * 25), 0, 100)
  const distinctScore = clamp(Math.round(safeRatio(u.distinctVideosH1, thresholds.userVid1h) * 40), 0, 100)
  const ipCountScore = clamp(Math.round((Number(u.ipCount) || 0) * 5), 0, 100)
  const total = clamp(Math.round(h6Score + h12Score + distinctScore + ipCountScore), 0, 100)
  return total
}

export function computeIpBreakdown(row, thresholds) {
  const h6Score = clamp(Math.round(safeRatio(row.distinctVideosH6, thresholds.ip6h) * 25), 0, 100)
  const h12Score = clamp(Math.round(safeRatio(row.distinctVideosH12, thresholds.ip12h) * 20), 0, 100)
  const distinctScore = clamp(Math.round(safeRatio(row.distinctVideosH1, thresholds.ipVid1h) * 35), 0, 100)
  const uaScore = clamp(Math.round((Number(row.uaDiversity) || 0) * 1.5), 0, 100)
  const baseTotal = clamp(Math.round(h6Score + h12Score + distinctScore + uaScore), 0, 100)
  const hardRuleTriggered = (
    (isPositiveNumber(thresholds.ipVid1h) && row.distinctVideosH1 >= thresholds.ipVid1h) ||
    (isPositiveNumber(thresholds.ip6h) && row.distinctVideosH6 >= thresholds.ip6h) ||
    (isPositiveNumber(thresholds.ip12h) && row.distinctVideosH12 >= thresholds.ip12h) ||
    (isPositiveNumber(thresholds.uaHard) && row.uaDiversity >= thresholds.uaHard)
  )
  return {
    components: [
      { key: '6h不同视频数', value: row.distinctVideosH6, threshold: thresholds.ip6h, weight: 25, score: h6Score },
      { key: '12h不同视频数', value: row.distinctVideosH12, threshold: thresholds.ip12h, weight: 20, score: h12Score },
      { key: '1h不同视频数', value: row.distinctVideosH1, threshold: thresholds.ipVid1h, weight: 35, score: distinctScore },
      { key: 'UA多样性', value: row.uaDiversity, threshold: thresholds.uaHard, weight: 1.5, score: uaScore }
    ],
    baseTotal,
    hardRuleTriggered
  }
}

export function computeUserBreakdown(u, thresholds) {
  const h6Score = clamp(Math.round(safeRatio(u.distinctVideosH6, thresholds.user6h) * 35), 0, 100)
  const h12Score = clamp(Math.round(safeRatio(u.distinctVideosH12, thresholds.user12h) * 25), 0, 100)
  const distinctScore = clamp(Math.round(safeRatio(u.distinctVideosH1, thresholds.userVid1h) * 40), 0, 100)
  const ipCountScore = clamp(Math.round((Number(u.ipCount) || 0) * 5), 0, 100)
  const baseTotal = clamp(Math.round(h6Score + h12Score + distinctScore + ipCountScore), 0, 100)
  const hardRuleTriggered = (
    (isPositiveNumber(thresholds.userVid1h) && u.distinctVideosH1 >= thresholds.userVid1h) ||
    (isPositiveNumber(thresholds.user6h) && u.distinctVideosH6 >= thresholds.user6h) ||
    (isPositiveNumber(thresholds.user12h) && u.distinctVideosH12 >= thresholds.user12h) ||
    (isPositiveNumber(thresholds.userIpHard) && u.ipCount >= thresholds.userIpHard)
  )
  return {
    components: [
      { key: '6h不同视频数', value: u.distinctVideosH6, threshold: thresholds.user6h, weight: 35, score: h6Score },
      { key: '12h不同视频数', value: u.distinctVideosH12, threshold: thresholds.user12h, weight: 25, score: h12Score },
      { key: '1h不同视频数', value: u.distinctVideosH1, threshold: thresholds.userVid1h, weight: 40, score: distinctScore },
      { key: 'IP数量', value: u.ipCount, threshold: thresholds.userIpHard, weight: 5, score: ipCountScore }
    ],
    baseTotal,
    hardRuleTriggered
  }
}