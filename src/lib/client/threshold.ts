/**
 * 倒數門檻「跨越」偵測（第十七節）：
 * 剩 2:00 與 0:00 各提醒一次，只在這一台裝置親眼看到跨過門檻時觸發
 * （上一個 tick 在門檻之上、這一個 tick 在門檻以下）；載入或 refresh 時已經過了的門檻不補觸發。
 */

export interface CrossingDetector {
  /**
   * 觀察一個新的剩餘值（ms）。
   * @param value 剩餘時間；null = 目前沒有倒數
   * @param key 倒數的對象（例如 assignment id）；換對象時重新開始，不算跨越
   * @returns 這次由上往下跨過的門檻（由大到小）；第一次觀察一律回傳空陣列
   */
  observe(value: number | null, key?: string | null): number[];
  reset(): void;
}

/**
 * @param thresholds 門檻（ms），例如 [ENDING_SOON_MS, 0]。
 * 「跨過」= 上一次 > 門檻 且 這一次 <= 門檻（與 ENDING_SOON：0 < r <= 2:00、OVERTIME：r <= 0 一致）。
 */
export function createCrossingDetector(thresholds: readonly number[]): CrossingDetector {
  const sorted = [...thresholds].sort((a, b) => b - a);
  let prev: number | null = null;
  let prevKey: string | null | undefined = undefined;

  return {
    observe(value, key = null) {
      if (key !== prevKey) {
        prevKey = key;
        prev = value;
        return [];
      }
      const before = prev;
      prev = value;
      if (value === null || before === null) return [];
      return sorted.filter((t) => before > t && value <= t);
    },
    reset() {
      prev = null;
      prevKey = undefined;
    },
  };
}
