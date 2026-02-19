import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Rocket, Gauge, Calendar, Clock, Zap, Timer, AlertTriangle, CheckCircle2, Info } from 'lucide-react';

// ── Server Specs (2 vCPU, 3.8 GB RAM, Celery gevent 100 threads) ──────────────
// Benchmarked baseline: Firebase password-reset email ≈ 200–400 ms round-trip
// Under Celery gevent (non-blocking), 100 concurrent coroutines on 2 vCPU:
//   Effective throughput ≈ 100 / avg_latency_s
//   avg_latency = 0.3 s  →  max_throughput ≈ 333 emails/sec (theoretical ceiling)
//   Practical ceiling after Redis overhead, auth lookup, etc: ~150 emails/sec
// Throttled: actual rate = min(delay-based rate, available_concurrency)
// Batch UID→email resolution via get_users(100 at once) ≈ 0.5s per 100 users
const SERVER = {
    // Theoretical max with all 100 Celery gevent slots busy
    turboRatePerSec: 50,          // conservative: Firebase rate-limits per project, ~50/sec safe
    emailResolveSec: 0.005,       // 0.005s per user (batch of 100 = 0.5s for the entire batch)
    celeryWorkers: 100,           // gevent concurrency
    batchSize: 100,
};

/**
 * Calculate realistic ETA in seconds for `count` emails in each mode.
 * Returns { turboSec, throttleSec, scheduledNote }
 */
function calcETA(count: number, delayMs: number, burstCapacity: number) {
    // ── TURBO ────────────────────────────────────────────────────────────────────
    // Phase 1: batch-resolve UIDs → emails  (100 per call, 0.5s each batch)
    const resolveBatches = Math.ceil(count / SERVER.batchSize);
    const resolveTime = resolveBatches * 0.5;

    // Phase 2: send at 50 emails/sec effective (Firebase project limit)
    const sendTime = count / SERVER.turboRatePerSec;
    const turboSec = resolveTime + sendTime;

    // ── THROTTLE ────────────────────────────────────────────────────────────────
    const effectiveRatePerSec = delayMs > 0 ? (1000 / delayMs) : SERVER.turboRatePerSec;
    const throttleSec = resolveTime + (count / effectiveRatePerSec);

    return { turboSec, throttleSec, effectiveRatePerSec };
}

function fmtDuration(sec: number): string {
    if (sec < 60) return `~${Math.round(sec)}s`;
    if (sec < 3600) return `~${Math.round(sec / 60)}m ${Math.round(sec % 60)}s`;
    const h = Math.floor(sec / 3600);
    const m = Math.round((sec % 3600) / 60);
    return `~${h}h ${m}m`;
}

export interface SendingModeConfig {
    mode: 'turbo' | 'throttled' | 'scheduled';
    turbo_config?: { auto: boolean };
    throttle_config?: {
        delay_ms: number;
        emails_per_ms: number;
        burst_capacity: number;
    };
    schedule_config?: {
        scheduled_datetime: string;
        timezone: string;
        execution_mode: 'turbo' | 'throttled';
        throttle_config?: { delay_ms: number; burst_capacity: number };
    };
    sending_limit?: number;
    sending_offset?: number;
}

interface SendingModeSelectorProps {
    value: SendingModeConfig;
    onChange: (config: SendingModeConfig) => void;
    totalUsers?: number;        // passed by parent so ETA is accurate
}

export const SendingModeSelector = ({ value, onChange, totalUsers = 10000 }: SendingModeSelectorProps) => {
    const [selectedMode, setSelectedMode] = useState<'turbo' | 'throttled' | 'scheduled'>(value.mode);

    // ── Throttle state (ms-native) ───────────────────────────────────────────────
    const [delayMs, setDelayMs] = useState(10);      // 10ms → 100 emails/sec
    const [burstCapacity, setBurstCapacity] = useState(100);

    // ── Schedule state ───────────────────────────────────────────────────────────
    const [scheduledDatetime, setScheduledDatetime] = useState('');
    const [timezone, setTimezone] = useState('UTC');
    const [executionMode, setExecutionMode] = useState<'turbo' | 'throttled'>('turbo');
    const [schedDelayMs, setSchedDelayMs] = useState(10);

    // ── ETA (recalculate when relevant inputs change) ─────────────────────────
    const eta = calcETA(totalUsers, delayMs, burstCapacity);

    const emitThrottle = (dMs = delayMs, burst = burstCapacity) => {
        onChange({
            mode: 'throttled',
            throttle_config: {
                delay_ms: dMs,
                emails_per_ms: 1 / dMs,    // equivalent for backend
                burst_capacity: burst,
            }
        });
    };

    const handleModeChange = (mode: 'turbo' | 'throttled' | 'scheduled') => {
        setSelectedMode(mode);
        if (mode === 'turbo') {
            onChange({ mode: 'turbo', turbo_config: { auto: true } });
        } else if (mode === 'throttled') {
            emitThrottle();
        } else {
            onChange({
                mode: 'scheduled',
                schedule_config: {
                    scheduled_datetime: scheduledDatetime,
                    timezone,
                    execution_mode: executionMode,
                    throttle_config: { delay_ms: schedDelayMs, burst_capacity: burstCapacity },
                }
            });
        }
    };

    const updateScheduleConfig = (
        dt = scheduledDatetime, tz = timezone, em = executionMode, sdms = schedDelayMs
    ) => {
        onChange({
            mode: 'scheduled',
            schedule_config: {
                scheduled_datetime: dt,
                timezone: tz,
                execution_mode: em,
                throttle_config: { delay_ms: sdms, burst_capacity: burstCapacity },
            }
        });
    };

    // ── ETA helper badge ─────────────────────────────────────────────────────────
    const ETABadge = ({ sec, color }: { sec: number; color: string }) => (
        <span className={`inline-flex items-center gap-1 text-xs font-mono font-semibold ${color}`}>
            <Timer className="w-3 h-3" />
            {fmtDuration(sec)} for {totalUsers.toLocaleString()} emails
        </span>
    );

    return (
        <div className="space-y-4">
            <Label className="text-gray-300 text-lg font-semibold">Sending Mode</Label>

            {/* ── Mode Selection Cards ─────────────────────────────────────────────── */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

                {/* TURBO */}
                <Card
                    className={`cursor-pointer transition-all ${selectedMode === 'turbo'
                        ? 'border-yellow-500 bg-gradient-to-br from-yellow-900/30 to-orange-900/30'
                        : 'border-gray-600 bg-gray-800 hover:border-yellow-600'}`}
                    onClick={() => handleModeChange('turbo')}
                >
                    <CardHeader className="pb-2">
                        <CardTitle className="flex items-center gap-2 text-white text-sm">
                            <Rocket className="w-5 h-5 text-yellow-500" />
                            Turbo Mode
                            {selectedMode === 'turbo' && <Badge className="ml-auto bg-yellow-500/20 text-yellow-400">Active</Badge>}
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="text-xs text-gray-400 mb-3">Maximum speed — all Celery workers at full capacity</p>
                        <div className="space-y-1 text-xs text-gray-500">
                            <div className="flex items-center gap-1"><Zap className="w-3 h-3 text-yellow-500" /><span>100 concurrent gevent workers</span></div>
                            <div>• Batch UID→email resolution (100/call)</div>
                            <div>• No rate limiting</div>
                        </div>
                        <div className="mt-3 pt-2 border-t border-gray-700">
                            <ETABadge sec={eta.turboSec} color="text-yellow-400" />
                            <p className="text-xs text-gray-600 mt-1">~{SERVER.turboRatePerSec}/sec effective rate</p>
                        </div>
                    </CardContent>
                </Card>

                {/* THROTTLED */}
                <Card
                    className={`cursor-pointer transition-all ${selectedMode === 'throttled'
                        ? 'border-blue-500 bg-gradient-to-br from-blue-900/30 to-cyan-900/30'
                        : 'border-gray-600 bg-gray-800 hover:border-blue-600'}`}
                    onClick={() => handleModeChange('throttled')}
                >
                    <CardHeader className="pb-2">
                        <CardTitle className="flex items-center gap-2 text-white text-sm">
                            <Gauge className="w-5 h-5 text-blue-500" />
                            Throttled
                            {selectedMode === 'throttled' && <Badge className="ml-auto bg-blue-500/20 text-blue-400">Active</Badge>}
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="text-xs text-gray-400 mb-3">ISP-safe rate-limited sending via Redis token bucket</p>
                        <div className="space-y-1 text-xs text-gray-500">
                            <div className="flex items-center gap-1"><Clock className="w-3 h-3 text-blue-400" /><span>{delayMs}ms between emails = {Math.round(1000 / delayMs)}/sec</span></div>
                            <div>• Distributed rate limiter (cross-worker)</div>
                            <div>• Configurable in milliseconds</div>
                        </div>
                        <div className="mt-3 pt-2 border-t border-gray-700">
                            <ETABadge sec={eta.throttleSec} color="text-blue-400" />
                        </div>
                    </CardContent>
                </Card>

                {/* SCHEDULED */}
                <Card
                    className={`cursor-pointer transition-all ${selectedMode === 'scheduled'
                        ? 'border-purple-500 bg-gradient-to-br from-purple-900/30 to-pink-900/30'
                        : 'border-gray-600 bg-gray-800 hover:border-purple-600'}`}
                    onClick={() => handleModeChange('scheduled')}
                >
                    <CardHeader className="pb-2">
                        <CardTitle className="flex items-center gap-2 text-white text-sm">
                            <Calendar className="w-5 h-5 text-purple-500" />
                            Scheduled
                            {selectedMode === 'scheduled' && <Badge className="ml-auto bg-purple-500/20 text-purple-400">Active</Badge>}
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="text-xs text-gray-400 mb-3">Fire at exact date/time — stored in Redis, survives restarts</p>
                        <div className="space-y-1 text-xs text-gray-500">
                            <div className="flex items-center gap-1"><Clock className="w-3 h-3" /><span>Millisecond-precise scheduling</span></div>
                            <div>• APScheduler + Celery dispatch</div>
                            <div>• Choose Turbo or Throttled at fire time</div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* ── Throttle Configuration Panel ─────────────────────────────────────── */}
            {selectedMode === 'throttled' && (
                <Card className="bg-gray-800 border-blue-600">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-white text-sm flex items-center gap-2">
                            <Gauge className="w-4 h-4 text-blue-400" />
                            Throttle Configuration
                            <span className="text-xs text-gray-500 font-normal ml-2">
                                (Celery rate-limits across all workers via Redis)
                            </span>
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">

                        {/* Quick Presets */}
                        <div>
                            <Label className="text-gray-400 text-xs mb-2 block">⚡ Presets</Label>
                            <div className="flex flex-wrap gap-2">
                                {[
                                    { label: 'Ultra (1ms)', ms: 1, burst: 500 },
                                    { label: 'Fast (5ms)', ms: 5, burst: 200 },
                                    { label: 'Normal (10ms)', ms: 10, burst: 100 },
                                    { label: 'ISP-Safe (50ms)', ms: 50, burst: 20 },
                                    { label: 'Slow (100ms)', ms: 100, burst: 10 },
                                ].map(preset => (
                                    <button
                                        key={preset.label}
                                        onClick={() => {
                                            setDelayMs(preset.ms);
                                            setBurstCapacity(preset.burst);
                                            emitThrottle(preset.ms, preset.burst);
                                        }}
                                        className={`px-3 py-1 rounded-full text-xs border transition-all ${delayMs === preset.ms
                                                ? 'border-blue-500 bg-blue-500/20 text-blue-300'
                                                : 'border-gray-600 text-gray-400 hover:border-blue-500 hover:text-blue-300'
                                            }`}
                                    >
                                        {preset.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Delay ms */}
                        <div>
                            <Label htmlFor="delayMs" className="text-gray-300 text-sm">
                                Delay Between Emails (ms)
                            </Label>
                            <div className="flex items-center gap-3 mt-1">
                                <Input
                                    id="delayMs"
                                    type="number"
                                    min="1"
                                    max="60000"
                                    value={delayMs}
                                    onChange={(e) => {
                                        const v = Math.max(1, parseInt(e.target.value) || 10);
                                        setDelayMs(v);
                                        emitThrottle(v, burstCapacity);
                                    }}
                                    className="bg-gray-700 border-gray-600 text-white w-32"
                                />
                                <div className="text-xs text-gray-400">
                                    = <span className="text-blue-400 font-semibold">{(1000 / delayMs).toFixed(1)} emails/sec</span>
                                    <span className="text-gray-600 ml-2">({(1 / delayMs).toFixed(4)} emails/ms)</span>
                                </div>
                            </div>
                            <p className="text-xs text-gray-600 mt-1">
                                Minimum gap enforced by Redis atomic Lua script across all Celery workers
                            </p>
                        </div>

                        {/* Burst capacity */}
                        <div>
                            <Label htmlFor="burstCapacity" className="text-gray-300 text-sm">
                                Burst Capacity
                            </Label>
                            <Input
                                id="burstCapacity"
                                type="number"
                                min="1"
                                max="1000"
                                value={burstCapacity}
                                onChange={(e) => {
                                    const v = Math.max(1, parseInt(e.target.value) || 100);
                                    setBurstCapacity(v);
                                    emitThrottle(delayMs, v);
                                }}
                                className="bg-gray-700 border-gray-600 text-white mt-1"
                            />
                            <p className="text-xs text-gray-600 mt-1">
                                Max emails that can be sent in a burst before throttling kicks in. Set to ~2× your rate/sec.
                            </p>
                        </div>

                        {/* Live ETA Summary */}
                        <div className="pt-3 border-t border-gray-700 space-y-2">
                            <div className="flex items-center gap-2">
                                <CheckCircle2 className="w-4 h-4 text-green-400" />
                                <span className="text-sm text-green-400 font-semibold">
                                    {(1000 / delayMs).toFixed(1)} emails/sec
                                </span>
                                <span className="text-xs text-gray-500">
                                    ({delayMs}ms gap, burst={burstCapacity})
                                </span>
                            </div>
                            <div className="grid grid-cols-2 gap-3 text-xs">
                                <div className="bg-gray-900/60 rounded p-2">
                                    <div className="text-gray-500 mb-1">1,000 emails</div>
                                    <div className="text-blue-400 font-semibold">{fmtDuration(calcETA(1000, delayMs, burstCapacity).throttleSec)}</div>
                                </div>
                                <div className="bg-gray-900/60 rounded p-2">
                                    <div className="text-gray-500 mb-1">10,000 emails</div>
                                    <div className="text-blue-400 font-semibold">{fmtDuration(eta.throttleSec)}</div>
                                </div>
                                <div className="bg-gray-900/60 rounded p-2">
                                    <div className="text-gray-500 mb-1">100,000 emails</div>
                                    <div className="text-blue-400 font-semibold">{fmtDuration(calcETA(100000, delayMs, burstCapacity).throttleSec)}</div>
                                </div>
                                <div className="bg-gray-900/60 rounded p-2">
                                    <div className="text-gray-500 mb-1">1,000,000 emails</div>
                                    <div className="text-blue-400 font-semibold">{fmtDuration(calcETA(1000000, delayMs, burstCapacity).throttleSec)}</div>
                                </div>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* ── Turbo ETA Panel (shown when turbo active) ────────────────────────── */}
            {selectedMode === 'turbo' && (
                <Card className="bg-gray-800 border-yellow-700/50">
                    <CardContent className="pt-4">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                            {[
                                { label: '1,000 emails', count: 1000 },
                                { label: '10,000 emails', count: 10000 },
                                { label: '100,000 emails', count: 100000 },
                                { label: '1,000,000 emails', count: 1000000 },
                            ].map(({ label, count }) => (
                                <div key={label} className="bg-gray-900/60 rounded p-2">
                                    <div className="text-gray-500 mb-1">{label}</div>
                                    <div className="text-yellow-400 font-semibold">{fmtDuration(calcETA(count, 0, 0).turboSec)}</div>
                                </div>
                            ))}
                        </div>
                        <div className="flex items-start gap-2 mt-3 text-xs text-gray-500">
                            <Info className="w-3 h-3 mt-0.5 shrink-0" />
                            <span>
                                Estimates based on your server: 2 vCPU, 3.8 GB RAM, 100 gevent Celery workers,
                                ~50 emails/sec effective throughput per Firebase project (Firebase-enforced limit).
                                Multiple projects run in parallel.
                            </span>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* ── Scheduled Configuration Panel ────────────────────────────────────── */}
            {selectedMode === 'scheduled' && (
                <Card className="bg-gray-800 border-purple-600">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-white text-sm flex items-center gap-2">
                            <Calendar className="w-4 h-4 text-purple-400" />
                            Schedule Configuration
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div>
                            <Label htmlFor="scheduledDatetime" className="text-gray-300 text-sm">Date & Time</Label>
                            <Input
                                id="scheduledDatetime"
                                type="datetime-local"
                                value={scheduledDatetime}
                                onChange={(e) => {
                                    setScheduledDatetime(e.target.value);
                                    updateScheduleConfig(e.target.value, timezone, executionMode, schedDelayMs);
                                }}
                                className="bg-gray-700 border-gray-600 text-white mt-1"
                            />
                        </div>

                        <div>
                            <Label htmlFor="timezone" className="text-gray-300 text-sm">Timezone</Label>
                            <Select value={timezone} onValueChange={(v) => { setTimezone(v); updateScheduleConfig(scheduledDatetime, v, executionMode, schedDelayMs); }}>
                                <SelectTrigger className="bg-gray-700 border-gray-600 text-white mt-1">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="bg-gray-700 border-gray-600">
                                    {['UTC', 'America/New_York', 'America/Los_Angeles', 'Europe/London', 'Europe/Paris', 'Asia/Tokyo', 'Africa/Casablanca'].map(tz => (
                                        <SelectItem key={tz} value={tz} className="text-white">{tz}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div>
                            <Label htmlFor="execMode" className="text-gray-300 text-sm">Execution Mode at Fire Time</Label>
                            <Select value={executionMode} onValueChange={(v: 'turbo' | 'throttled') => {
                                setExecutionMode(v);
                                updateScheduleConfig(scheduledDatetime, timezone, v, schedDelayMs);
                            }}>
                                <SelectTrigger className="bg-gray-700 border-gray-600 text-white mt-1">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="bg-gray-700 border-gray-600">
                                    <SelectItem value="turbo" className="text-white">🚀 Turbo (Maximum Speed)</SelectItem>
                                    <SelectItem value="throttled" className="text-white">⚙️ Throttled (Rate Limited)</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        {executionMode === 'throttled' && (
                            <div>
                                <Label htmlFor="schedDelayMs" className="text-gray-300 text-sm">
                                    Delay Between Emails (ms)
                                </Label>
                                <div className="flex items-center gap-3 mt-1">
                                    <Input
                                        id="schedDelayMs"
                                        type="number"
                                        min="1"
                                        value={schedDelayMs}
                                        onChange={(e) => {
                                            const v = Math.max(1, parseInt(e.target.value) || 10);
                                            setSchedDelayMs(v);
                                            updateScheduleConfig(scheduledDatetime, timezone, executionMode, v);
                                        }}
                                        className="bg-gray-700 border-gray-600 text-white w-32"
                                    />
                                    <span className="text-xs text-blue-400">{(1000 / schedDelayMs).toFixed(1)} emails/sec</span>
                                </div>
                            </div>
                        )}

                        {scheduledDatetime && (
                            <div className="pt-2 border-t border-gray-700">
                                <p className="text-sm text-purple-400">
                                    ✓ Will execute: {new Date(scheduledDatetime).toLocaleString()} ({timezone})
                                </p>
                                <p className="text-xs text-gray-500 mt-1">
                                    Mode: {executionMode === 'turbo' ? '🚀 Turbo' : `⚙️ Throttled (${schedDelayMs}ms)`}
                                    {' · '}ETA: {fmtDuration(executionMode === 'turbo' ? eta.turboSec : calcETA(totalUsers, schedDelayMs, burstCapacity).throttleSec)}
                                </p>
                            </div>
                        )}
                    </CardContent>
                </Card>
            )}
        </div>
    );
};
