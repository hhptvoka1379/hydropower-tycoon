// Constants owned by the economy agent (§7 finance, §8 construction). Merged into CONFIG by src/config.js.
// Add new keys only; never alter contract keys. Money in $, energy in MWh, power in MW unless stated.
export default Object.freeze({
  finance: Object.freeze({
    om: Object.freeze({ perMWHour: 0.15, perMWhThru: 0.10 }),   // $/MW/h and $/MWh (§7.2)
    monthDays: 30,                                              // game days per month (§7.3)
    loan: Object.freeze({
      minMonths: 12, maxMonths: 60,                             // 1 to 5 years (§7.3)
      // APR by amount: up to 25,000 6%, up to 100,000 7%, above 8% (§7.3)
      aprTiers: Object.freeze([
        Object.freeze({ upTo: 25000, apr: 0.06 }),
        Object.freeze({ upTo: 100000, apr: 0.07 }),
        Object.freeze({ upTo: null, apr: 0.08 }),
      ]),
      creditBase: 25000,                                        // $ (§7.3)
      creditEquipFrac: 0.5,                                     // of owned equipment purchase price (§7.3)
    }),
    emergency: Object.freeze({
      add: 5000, roundTo: 1000,                                 // $ shortfall + 5,000 rounded up to 1,000 (§7.3)
      apr: 0.12, months: 6,                                     // (§7.3)
    }),
    npv: Object.freeze({ r: 0.05, N: 20, cyclesPerDay: 1, cycleHours: 6, peakHours: 6, offHours: 6, daysPerYear: 365 }), // (§7.4, §7.5)
    contracts: Object.freeze([                                  // (§7.6)
      Object.freeze({ id: 'small', C_MW: 0.2, price: 48, minPumpMW: 0 }),     // MW, $/MWh
      Object.freeze({ id: 'large', C_MW: 0.5, price: 52, minPumpMW: 1.5 }),
    ]),
    contractDays: 30,                                           // (§7.6)
    shortfallMult: 3, shortfallPriceFloor: 20,                  // 3·max(Price,20) $/MWh (§7.6)
    finePerM3: 0.50,                                            // $/m³ spilled or unmet release (§9.4, §9.5, hand-off from Physics)
    hoursPerYear: 8760,                                         // h (§7.4 annualization of O&M)
  }),
  siting: Object.freeze({                                       // §8.4 siting panel and solver helpers
    previewHeights: Object.freeze([20, 30]),                    // m, dams priced in the siting panel (§8.4)
    stationScanStep: 5,                                         // m, scan step for the narrowest W_bot (§8.4)
    grossHeadBase: 40,                                          // m, gross head ≈ 40 m + H_dam (§8.4)
  }),
});
