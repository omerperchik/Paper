---
name: marketing-meta
description: >
  Meta-optimization workflows for the marketing meta agent. Covers agent trace
  analysis, prompt improvement patterns, threshold tuning, skill creation from
  repeated workflows, anti-gaming validation, and performance benchmarking
  across all marketing agents.
version: "1.0.0"
author: marketing-team
tags:
  - marketing
  - meta-optimization
  - agent-performance
  - prompt-engineering
  - benchmarking
  - anti-gaming
  - skill-creation
required_tools:
  - marketing_calculate_cac
  - marketing_anomaly_detect
  - marketing_experiment_score
---

# Meta-Optimization Skill

The Meta Optimizer is the self-improving engine of the marketing team. It analyzes all other agents' performance traces, identifies failure patterns, and surgically improves prompts, thresholds, and workflows.

## 1. Agent Trace Analysis

### What Is a Trace

A trace is the full record of an agent's execution: the input it received, the reasoning steps it took, the tools it called, the outputs it produced, and the time and cost of each step.

### Trace Collection

For every agent execution, capture:

```
trace_record:
  agent_id: {agent_name}
  task_id: {unique_task_id}
  timestamp: {ISO 8601}
  input: {the prompt or trigger that started the task}
  steps:
    - step_n:
        action: {tool call, reasoning, output generation}
        input: {what was passed to this step}
        output: {what this step produced}
        duration_ms: {time taken}
        tokens_used: {input + output tokens}
  final_output: {the deliverable produced}
  quality_score: {score from quality gate, if applicable}
  cost: {total token cost}
  success: {true/false — did the task complete as intended}
  failure_reason: {if success is false}
  fallback_used: {true/false — did agent fall back to secondary model}
```

### Weekly Trace Analysis Procedure

Run every Sunday at 11 PM or on demand:

#### Step 1 — Gather Agent Run Data

Collect for the past 7 days per agent:
- Total runs
- Success rate (completed vs. errored)
- Approval rate (approved vs. rejected in approval queue)
- Fallback rate (primary AI vs. fallback model usage)
- Average latency per run
- Token usage per run
- Cost per run

#### Step 2 — Sample Traces

- All errored runs (up to 20)
- All rejected approval items (up to 20)
- Random sample of 5 successful runs per agent (baseline comparison)
- Any runs where fallback model was used

#### Step 3 — Performance Summary

```
Agent Performance — Week of YYYY-MM-DD
========================================
Agent                | Runs | Success | Approval | Fallback | Avg Latency | Cost
Content Strategist   |   32 |    94%  |     88%  |      3%  |      12.4s  | $2.10
SEO Specialist       |   28 |    96%  |     92%  |      0%  |       8.2s  | $1.40
...
```

#### Step 4 — Failure Classification

Classify every failed trace into one of these categories:

| Failure Type | Description | Example |
|-------------|-------------|---------|
| model_timeout | Context overflow or model took too long | Prompt exceeded token limit |
| tool_error | External tool failed | API down, auth expired, rate limit |
| quality_gate_failure | Output did not meet threshold | Humanizer score below 80 |
| task_misunderstanding | Agent misinterpreted the task | Wrong tool used, off-topic output |
| budget_exceeded | Run exceeded cost allocation | Too many retries, excessive tokens |
| prompt_ambiguity | Input was unclear | Multiple valid interpretations led to wrong one |

Track failure frequency by type per agent. If any failure type exceeds 10% of executions: flag for prompt improvement.

#### Step 5 — Efficiency Analysis

```
For each agent:
  1. Identify the slowest 10% of traces by duration.
  2. Find common patterns:
     - Excessive retries (same tool called 3+ times)?
     - Unnecessary steps (steps that do not contribute to output)?
     - Sequential steps that could be parallelized?
  3. Calculate waste_ratio:
     waste_ratio = (total_tokens - minimum_necessary_tokens) / total_tokens
     (Estimate minimum_necessary from the leanest successful traces)
  4. Check fallback rates — which agents have high fallback rates?
  5. Check latency — which agents have prompts that are too long?
  6. Check budget — which agents are over-allocated?
```

#### Step 6 — Rejection Pattern Analysis

For each rejected approval item:
1. Which agent submitted it?
2. What type of content or action was rejected?
3. Rejection reason (if provided)?
4. Is this a recurring rejection type?

Group rejections by pattern and prioritize the most frequent patterns for prompt fixes.

## 2. Prompt Improvement Patterns

### Pattern Library

Apply these proven patterns when trace analysis reveals specific issues.

#### Pattern: Explicit Output Format

**Problem**: Agent produces inconsistent output formats.
**Fix**: Add a strict output template with field names and types.

```
Before: "Analyze the campaign and provide recommendations."
After: "Analyze the campaign. Output a markdown table with columns:
Campaign Name | Metric | Current Value | Target | Gap | Recommendation.
Include exactly one row per metric."
```

#### Pattern: Chain-of-Thought Enforcement

**Problem**: Agent skips reasoning steps and produces incorrect conclusions.
**Fix**: Require explicit step-by-step reasoning before conclusions.

```
Add to prompt: "Before providing your final answer, work through
these steps explicitly:
1. State the relevant data points.
2. Identify the key comparison or calculation.
3. Show your work.
4. State your conclusion.
5. Verify your conclusion against the data."
```

#### Pattern: Negative Examples

**Problem**: Agent makes a specific mistake repeatedly.
**Fix**: Add an explicit "do not" section with the observed bad behavior.

```
Add to prompt: "IMPORTANT: Do NOT [specific bad behavior observed in traces].
Instead, [correct behavior]. Example of wrong output: [example from trace].
Example of correct output: [corrected version]."
```

#### Pattern: Guardrail Injection

**Problem**: Agent occasionally produces outputs that violate constraints.
**Fix**: Add pre-output checklist the agent must verify before responding.

```
Add to prompt: "Before returning your response, verify:
- [ ] No banned words from the banned list appear in the output.
- [ ] All numbers are sourced from provided data (no fabricated statistics).
- [ ] Response length is between {min} and {max} words.
- [ ] The primary CTA is included exactly once."
```

#### Pattern: Context Window Management

**Problem**: Agent performance degrades on long tasks as context fills up.
**Fix**: Summarize intermediate results and pass summaries instead of full history.

```
Add to prompt: "After completing each major section, summarize your
findings in 2-3 sentences. Use only the summaries (not the full analysis)
when writing the final report."
```

#### Pattern: Role Anchoring

**Problem**: Agent drifts from its expertise into areas where it is less reliable.
**Fix**: Reinforce the agent's role and boundaries at the start and middle of long prompts.

```
Add to prompt: "You are the [role] agent. Your expertise is [domain].
If a task falls outside your domain, hand it off to [other agent]
rather than attempting it yourself."
```

### Prompt Patch Procedure

When applying prompt changes based on the patterns above:

1. **Identify the root cause** in the system prompt from failed traces.
2. **Draft a targeted patch** (not a full rewrite).
3. **Validate the patch:**
   - Would this fix the specific failure cases?
   - Would this still work for successful cases?
   - Anti-gaming check: "Would this help if the exact task changed?"
4. **Test on 5 historical traces**: re-run the same inputs with the new prompt.
5. **Compare outputs**: Did quality scores improve? Did the failure pattern disappear? Did new failures appear?
6. **If improvement confirmed on 4/5 traces**: deploy the prompt change.
7. **Monitor for 1 week post-deployment**. Revert if success rate drops.

**Prompt patch principles:**
- Incremental changes only (never rewrite > 20% of prompt in one cycle)
- Add specificity where vagueness caused failures
- Add guardrails where quality drifted
- Remove instructions that are consistently ignored

## 3. Threshold Tuning

### Tunable Thresholds

| Threshold | Default | What It Controls |
|-----------|---------|-----------------|
| Humanizer minimum score | 80 | Content quality gate pass/fail |
| Expert panel minimum score | 80 | Panel review pass/fail |
| Anomaly z-score warning | 2.0 | When analytics flags a metric |
| Anomaly z-score alert | 3.0 | When analytics escalates urgently |
| Creative fatigue CTR decline | 20% | When paid agent replaces a creative |
| Engagement ratio (Reddit) | 15:1 | Non-promotional to promotional comments |
| A/B test confidence | 95% | When CRO declares a test winner |
| Budget shift max per week | 25% | How aggressively paid agent reallocates |
| Email frequency cap | 3/week | Maximum emails per user per week |
| CAC alert threshold | per channel | When cost per acquisition flags a channel |
| Budget warning percentage | 80% | When to warn about budget consumption |
| Experiment minimum sample size | varies | Minimum data before evaluating a test |

### Tuning Procedure

```
1. Identify a threshold that may need adjustment:
   - Too strict: Excessive false positives, agents retrying excessively.
   - Too loose: Poor-quality outputs passing, issues not caught.

2. Pull data from the last 30 days:
   - How many times was the threshold triggered?
   - Of those triggers, what % were true positives (correctly caught an issue)?
   - What % were false positives (triggered unnecessarily)?
   - What was the cost of each trigger (retries, delays, manual review)?

3. Calculate the optimal adjustment:
   - If false positive rate > 20%: loosen the threshold by 10%.
   - If false negative rate > 5%: tighten the threshold by 10%.
   - If both rates are acceptable: no change needed.

4. Apply the new threshold.
5. Monitor for 2 weeks.
6. If false positive OR false negative rate worsens: revert immediately.
```

### Tuning Rules

- Never change a threshold by more than 10% in one cycle.
- Only tune based on 10+ data points.
- Revert if the next cycle shows degradation.
- Document every threshold change with rationale and expected impact.

### Threshold Drift Detection

Run monthly:

```
For each threshold:
  pull 30-day trigger data
  compare to previous 30-day period
  if trigger_rate changed by > 25%:
      flag for review (external conditions may have shifted)
  if quality_of_triggered_items changed significantly:
      flag for threshold recalibration
```

## 4. Skill Creation from Workflows

### When to Create a New Skill

A new skill should be created when:

1. An agent performs the same multi-step workflow 5+ times in 30 days.
2. The workflow involves 3+ distinct steps that are always executed together.
3. The workflow produces a consistent output format.
4. Multiple agents could benefit from the workflow.

### Skill Creation Procedure

```
1. Identify the repeated workflow from trace analysis.
2. Extract the common steps:
   - What inputs does it require?
   - What steps are always performed?
   - What outputs does it produce?
   - What quality checks are applied?
3. Generalize the steps:
   - Replace hard-coded values with parameters.
   - Identify optional vs. required steps.
   - Document edge cases from trace history.
4. Draft the SKILL.md following the standard format:
   - YAML frontmatter (name, description, version, tags)
   - Step-by-step procedures with numbered steps
   - Input/output specifications
   - Quality gates and thresholds
5. Test the skill:
   - Re-run 5 historical traces using the new skill.
   - Verify outputs match or exceed original quality.
6. Validate: would this help other agents facing similar tasks?
7. Register in the skills directory.
8. Deploy and monitor for 2 weeks.
```

### Skill Quality Checklist

Before deploying any new skill:

- [ ] Every step is specific enough that an agent can execute it without ambiguity
- [ ] Input parameters are documented with types and examples
- [ ] Output format is specified with a template
- [ ] Quality gates are defined with numeric thresholds
- [ ] Edge cases and failure modes are documented
- [ ] The skill does not duplicate existing skill functionality
- [ ] At least 3 historical examples validate the skill produces correct results
- [ ] YAML frontmatter includes name, description, version, and tags

## 5. Anti-Gaming Validation

Before applying any optimization, run these four checks:

### Check 1 — Metric Gaming

"Could this optimization inflate a metric without improving real outcomes?"

Examples of gaming to detect:
- Content agent uses complex synonyms to avoid banned words while keeping AI-sounding tone.
- Social agent inflates engagement by posting controversy instead of valuable content.
- SEO agent targets low-competition keywords that drive traffic but not conversions.
- Paid agent shifts budget to cheapest channel regardless of lead quality.
- Lowering quality threshold improves approval rate but hurts content quality.
- Changing CAC calculation method lowers reported CAC without reducing actual spend.

### Check 2 — Goodhart's Law

"If agents optimized specifically for this metric, would it still be valuable?"

If the answer is no, the metric needs a complementary check. For example, if optimizing for "blog posts published per week," add a quality check like "average traffic per post at 30 days."

### Check 3 — Cross-Agent Impact

"Does this optimization for Agent A negatively impact Agent B?"

Example: Content agent increasing output volume overwhelms the social agent's distribution capacity, leading to quality drops in social posts.

### Check 4 — Reversibility

"Can we easily revert this if it goes wrong?"

Every optimization must have a documented rollback procedure. If rollback is complex or risky, the optimization requires CMO approval before deployment.

### Detection Methods

#### Metric Correlation Check

```
For each primary metric an agent optimizes:
  1. Identify the downstream business metric it should drive.
  2. Calculate the correlation between the two over 30 days.
  3. If correlation < 0.3: flag for investigation.
     The agent may be optimizing the proxy without improving the real outcome.
```

#### Human Audit Sampling

```
Weekly:
  1. Randomly sample 5% of each agent's outputs.
  2. Human reviewer scores each on a 1-10 quality scale (blind to agent score).
  3. Compare human scores to agent self-scores.
  4. If average discrepancy > 2 points: the agent's quality gate may be gameable.
```

#### Adversarial Testing

```
Monthly:
  1. For each quality gate, craft 3 inputs designed to game the system.
  2. Run them through the gate.
  3. If any gaming input passes: the gate needs strengthening.
  4. Document the vulnerability and add a counter-measure.
```

#### Outcome Tracking

```
For each agent's outputs, track the downstream result:
  - Content: did the piece drive traffic, engagement, conversions?
  - Social: did posts drive meaningful engagement (not just impressions)?
  - Email: did sends drive opens, clicks, conversions (not just volume)?
  - Paid: did spend drive qualified leads (not just cheap clicks)?

Compare agents scoring high on internal metrics but low on outcomes.
These are gaming candidates.
```

### Anti-Gaming Response

When gaming is detected:

1. Identify the metric being gamed and the gaming behavior.
2. Add the gaming pattern to the quality gate as an explicit negative example.
3. Add an outcome-based secondary check.
4. Tighten the threshold for the gamed metric for 30 days while monitoring.
5. Document the pattern in the anti-gaming registry for future detection.

## 6. Performance Benchmarking

### Agent Health Score (0-100)

Weighted composite per agent:

```
health_score = (success_rate * 0.30) +
               (approval_rate * 0.25) +
               (efficiency * 0.20) +
               (latency_score * 0.10) +
               (fallback_score * 0.10) +
               (improvement_trend * 0.05)

Where:
  efficiency = normalized(1 / cost_per_successful_output)
  latency_score = normalized(1 / avg_latency)
  fallback_score = normalized(1 - fallback_rate)
  improvement_trend = normalized(this_week_score - last_week_score)
  All values normalized to 0-100 scale
```

### Team Health Score

Average of all agents' health scores, with CMO agent weighted 2x.

### Benchmarking Procedure

Run monthly:

```
1. Collect all traces for each agent for the month.
2. Calculate each benchmark dimension:
   - Quality: Average quality gate score
   - Reliability: Success rate
   - Efficiency: Cost per completed task
   - Speed: Average duration from trigger to output
   - Impact: Outputs that drove measurable business results
3. Compare to previous month (month-over-month trend).
4. Compare to 3-month rolling average (trend direction).
5. Rank agents on each dimension.
6. Identify:
   - Top performer per dimension
   - Most improved agent
   - Agent with declining performance (needs investigation)
```

### Historical Tracking

Maintain a 12-week rolling history of:
- Agent health scores
- Blended CAC
- Total marketing spend efficiency
- Number of optimizations applied
- Number of optimizations reverted

### Benchmark Report

```markdown
## Marketing Agent Benchmark — {month}

### Overall Ranking

| Rank | Agent | Quality | Reliability | Efficiency | Speed | Impact | Composite |
|------|-------|---------|------------|------------|-------|--------|-----------|
| 1 | {name} | {score} | {rate}% | ${cost} | {time} | {rate}% | {score} |

### Month-over-Month Trends

| Agent | Quality Trend | Reliability Trend | Efficiency Trend |
|-------|--------------|-------------------|-----------------|
| {name} | {up/down/flat} ({delta}) | {up/down/flat} ({delta}) | {up/down/flat} ({delta}) |

### Changes Applied This Cycle
- [Agent] {name}: {description of prompt patch or threshold change}
- [Threshold] {name}: {old_value} -> {new_value} ({rationale})

### Recommendations (Pending Approval)
- {specific actions for underperforming agents}
- {patterns from top performers to replicate}

### Flagged Concerns
- {agents with declining trends for 2+ consecutive months}
- {agents scoring below 50 composite}
- {any agent with 15+ point decline month-over-month}
```

Investigate any agent scoring below 50 on the composite or showing a 15+ point decline month-over-month. Agents declining for 2+ consecutive months require a full prompt and workflow review.
