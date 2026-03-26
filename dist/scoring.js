import { config } from "./config.js";
export function computePoints(counts, customRules) {
    const rules = customRules || config.scoring;
    return (counts.mous * rules.mou +
        counts.coldCalls * rules.coldCall +
        counts.followups * rules.followup);
}
