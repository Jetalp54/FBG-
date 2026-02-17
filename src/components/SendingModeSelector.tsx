import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Rocket, Gauge, Calendar, Clock, Zap } from 'lucide-react';

export interface SendingModeConfig {
    mode: 'turbo' | 'throttled' | 'scheduled';
    turbo_config?: {
        auto: boolean;
    };
    throttle_config?: {
        emails_per_ms: number;
        burst_capacity: number;
        workers: number;
    };
    schedule_config?: {
        scheduled_datetime: string;
        timezone: string;
        execution_mode: 'turbo' | 'throttled';
    };
    sending_limit?: number;
    sending_offset?: number;
}

interface SendingModeSelectorProps {
    value: SendingModeConfig;
    onChange: (config: SendingModeConfig) => void;
}

export const SendingModeSelector = ({ value, onChange }: SendingModeSelectorProps) => {
    const [selectedMode, setSelectedMode] = useState<'turbo' | 'throttled' | 'scheduled'>(value.mode);

    // Throttle mode state
    const [emailsPerSec, setEmailsPerSec] = useState(10);
    const [burstCapacity, setBurstCapacity] = useState(50);
    const [workers, setWorkers] = useState(5);

    // Schedule mode state
    const [scheduledDatetime, setScheduledDatetime] = useState('');
    const [timezone, setTimezone] = useState('UTC');
    const [executionMode, setExecutionMode] = useState<'turbo' | 'throttled'>('turbo');

    const handleModeChange = (mode: 'turbo' | 'throttled' | 'scheduled') => {
        setSelectedMode(mode);

        if (mode === 'turbo') {
            onChange({
                mode: 'turbo',
                turbo_config: { auto: true }
            });
        } else if (mode === 'throttled') {
            // Convert emails/second to emails/millisecond
            const emails_per_ms = emailsPerSec / 1000;
            onChange({
                mode: 'throttled',
                throttle_config: {
                    emails_per_ms,
                    burst_capacity: burstCapacity,
                    workers
                }
            });
        } else if (mode === 'scheduled') {
            onChange({
                mode: 'scheduled',
                schedule_config: {
                    scheduled_datetime: scheduledDatetime,
                    timezone,
                    execution_mode: executionMode
                }
            });
        }
    };

    const updateThrottleConfig = () => {
        const emails_per_ms = emailsPerSec / 1000;
        onChange({
            mode: 'throttled',
            throttle_config: {
                emails_per_ms,
                burst_capacity: burstCapacity,
                workers
            }
        });
    };

    const updateScheduleConfig = () => {
        onChange({
            mode: 'scheduled',
            schedule_config: {
                scheduled_datetime: scheduledDatetime,
                timezone,
                execution_mode: executionMode
            }
        });
    };

    const getCPUWorkers = () => {
        // Estimate: typical browser environments have 4-8 cores
        const estimatedCPU = 4;
        return estimatedCPU * 6;
    };

    return (
        <div className="space-y-4">
            <Label className="text-gray-300 text-lg font-semibold">Sending Mode</Label>

            {/* Mode Selection Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* TURBO MODE */}
                <Card
                    className={`cursor-pointer transition-all ${selectedMode === 'turbo'
                        ? 'border-yellow-500 bg-gradient-to-br from-yellow-900/30 to-orange-900/30'
                        : 'border-gray-600 bg-gray-800 hover:border-yellow-600'
                        }`}
                    onClick={() => handleModeChange('turbo')}
                >
                    <CardHeader className="pb-3">
                        <CardTitle className="flex items-center gap-2 text-white">
                            <Rocket className="w-5 h-5 text-yellow-500" />
                            Turbo Mode
                            {selectedMode === 'turbo' && (
                                <Badge className="ml-auto bg-yellow-500/20 text-yellow-400">Active</Badge>
                            )}
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="text-sm text-gray-400 mb-3">
                            Maximum speed - Use all resources
                        </p>
                        <div className="space-y-1 text-xs text-gray-500">
                            <div className="flex items-center gap-1">
                                <Zap className="w-3 h-3" />
                                <span>~{getCPUWorkers()} parallel workers</span>
                            </div>
                            <div>• No delays or rate limiting</div>
                            <div>• Aggressive batch processing</div>
                        </div>
                    </CardContent>
                </Card>

                {/* THROTTLED MODE */}
                <Card
                    className={`cursor-pointer transition-all ${selectedMode === 'throttled'
                        ? 'border-blue-500 bg-gradient-to-br from-blue-900/30 to-cyan-900/30'
                        : 'border-gray-600 bg-gray-800 hover:border-blue-600'
                        }`}
                    onClick={() => handleModeChange('throttled')}
                >
                    <CardHeader className="pb-3">
                        <CardTitle className="flex items-center gap-2 text-white">
                            <Gauge className="w-5 h-5 text-blue-500" />
                            Throttled Mode
                            {selectedMode === 'throttled' && (
                                <Badge className="ml-auto bg-blue-500/20 text-blue-400">Active</Badge>
                            )}
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="text-sm text-gray-400 mb-3">
                            Controlled rate - ISP-friendly sending
                        </p>
                        <div className="space-y-1 text-xs text-gray-500">
                            <div className="flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                <span>Configurable: {emailsPerSec} emails/sec</span>
                            </div>
                            <div>• Millisecond precision</div>
                            <div>• Token bucket algorithm</div>
                        </div>
                    </CardContent>
                </Card>

                {/* SCHEDULED MODE */}
                <Card
                    className={`cursor-pointer transition-all ${selectedMode === 'scheduled'
                        ? 'border-purple-500 bg-gradient-to-br from-purple-900/30 to-pink-900/30'
                        : 'border-gray-600 bg-gray-800 hover:border-purple-600'
                        }`}
                    onClick={() => handleModeChange('scheduled')}
                >
                    <CardHeader className="pb-3">
                        <CardTitle className="flex items-center gap-2 text-white">
                            <Calendar className="w-5 h-5 text-purple-500" />
                            Scheduled Mode
                            {selectedMode === 'scheduled' && (
                                <Badge className="ml-auto bg-purple-500/20 text-purple-400">Active</Badge>
                            )}
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="text-sm text-gray-400 mb-3">
                            Schedule for later execution
                        </p>
                        <div className="space-y-1 text-xs text-gray-500">
                            <div className="flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                <span>Set future date & time</span>
                            </div>
                            <div>• Auto-execution</div>
                            <div>• Choose Turbo or Throttled at runtime</div>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Configuration Panels */}
            {selectedMode === 'throttled' && (
                <Card className="bg-gray-800 border-blue-600">
                    <CardHeader>
                        <CardTitle className="text-white text-sm">Throttle Configuration</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div>
                            <Label htmlFor="emailsPerSec" className="text-gray-300 text-sm">
                                Emails per Second
                            </Label>
                            <Input
                                id="emailsPerSec"
                                type="number"
                                min="1"
                                max="1000"
                                value={emailsPerSec}
                                onChange={(e) => {
                                    setEmailsPerSec(parseInt(e.target.value) || 10);
                                    setTimeout(updateThrottleConfig, 100);
                                }}
                                className="bg-gray-700 border-gray-600 text-white"
                            />
                            <p className="text-xs text-gray-500 mt-1">
                                Rate: {(emailsPerSec / 1000).toFixed(5)} emails/ms
                            </p>
                        </div>

                        <div>
                            <Label htmlFor="burstCapacity" className="text-gray-300 text-sm">
                                Burst Capacity
                            </Label>
                            <Input
                                id="burstCapacity"
                                type="number"
                                min="1"
                                max="200"
                                value={burstCapacity}
                                onChange={(e) => {
                                    setBurstCapacity(parseInt(e.target.value) || 50);
                                    setTimeout(updateThrottleConfig, 100);
                                }}
                                className="bg-gray-700 border-gray-600 text-white"
                            />
                            <p className="text-xs text-gray-500 mt-1">
                                Maximum burst size for token bucket
                            </p>
                        </div>

                        <div>
                            <Label htmlFor="workers" className="text-gray-300 text-sm">
                                Parallel Workers
                            </Label>
                            <Input
                                id="workers"
                                type="number"
                                min="1"
                                max="20"
                                value={workers}
                                onChange={(e) => {
                                    setWorkers(parseInt(e.target.value) || 5);
                                    setTimeout(updateThrottleConfig, 100);
                                }}
                                className="bg-gray-700 border-gray-600 text-white"
                            />
                            <p className="text-xs text-gray-500 mt-1">
                                Number of concurrent workers (with rate limiting)
                            </p>
                        </div>

                        <div className="pt-2 border-t border-gray-700">
                            <p className="text-sm text-green-400">
                                ✓ Estimated: ~{emailsPerSec} emails per second
                            </p>
                            <p className="text-xs text-gray-500">
                                Actual rate may vary based on server performance
                            </p>
                        </div>
                    </CardContent>
                </Card>
            )}

            {selectedMode === 'scheduled' && (
                <Card className="bg-gray-800 border-purple-600">
                    <CardHeader>
                        <CardTitle className="text-white text-sm">Schedule Configuration</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div>
                            <Label htmlFor="scheduledDatetime" className="text-gray-300 text-sm">
                                Scheduled Date & Time
                            </Label>
                            <Input
                                id="scheduledDatetime"
                                type="datetime-local"
                                value={scheduledDatetime}
                                onChange={(e) => {
                                    setScheduledDatetime(e.target.value);
                                    setTimeout(updateScheduleConfig, 100);
                                }}
                                className="bg-gray-700 border-gray-600 text-white"
                            />
                            <p className="text-xs text-gray-500 mt-1">
                                Campaign will execute at this time
                            </p>
                        </div>

                        <div>
                            <Label htmlFor="timezone" className="text-gray-300 text-sm">
                                Timezone
                            </Label>
                            <Select value={timezone} onValueChange={(val) => {
                                setTimezone(val);
                                setTimeout(updateScheduleConfig, 100);
                            }}>
                                <SelectTrigger className="bg-gray-700 border-gray-600 text-white">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="bg-gray-700 border-gray-600">
                                    <SelectItem value="UTC" className="text-white">UTC</SelectItem>
                                    <SelectItem value="America/New_York" className="text-white">America/New_York (EST/EDT)</SelectItem>
                                    <SelectItem value="America/Los_Angeles" className="text-white">America/Los_Angeles (PST/PDT)</SelectItem>
                                    <SelectItem value="Europe/London" className="text-white">Europe/London (GMT/BST)</SelectItem>
                                    <SelectItem value="Europe/Paris" className="text-white">Europe/Paris (CET/CEST)</SelectItem>
                                    <SelectItem value="Asia/Tokyo" className="text-white">Asia/Tokyo (JST)</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        <div>
                            <Label htmlFor="executionMode" className="text-gray-300 text-sm">
                                Execution Mode at Scheduled Time
                            </Label>
                            <Select value={executionMode} onValueChange={(val: 'turbo' | 'throttled') => {
                                setExecutionMode(val);
                                setTimeout(updateScheduleConfig, 100);
                            }}>
                                <SelectTrigger className="bg-gray-700 border-gray-600 text-white">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="bg-gray-700 border-gray-600">
                                    <SelectItem value="turbo" className="text-white">
                                        <span className="flex items-center gap-2">
                                            <Rocket className="w-4 h-4" />
                                            Turbo Mode (Maximum Speed)
                                        </span>
                                    </SelectItem>
                                    <SelectItem value="throttled" className="text-white">
                                        <span className="flex items-center gap-2">
                                            <Gauge className="w-4 h-4" />
                                            Throttled Mode (Rate Limited)
                                        </span>
                                    </SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        {scheduledDatetime && (
                            <div className="pt-2 border-t border-gray-700">
                                <p className="text-sm text-purple-400">
                                    ✓ Will execute on {new Date(scheduledDatetime).toLocaleString()} ({timezone})
                                </p>
                                <p className="text-xs text-gray-500">
                                    Using {executionMode === 'turbo' ? 'Turbo' : 'Throttled'} mode
                                </p>
                            </div>
                        )}
                    </CardContent>
                </Card>
            )}
        </div>
    );
};
