import { describe, it, expect, jest, beforeEach } from '@jest/globals';

type LifecycleModule = typeof import('../../lifecycle.js');
type FnMock = ReturnType<typeof jest.fn>;

type MockContext = {
	scheduleMock: FnMock;
	scheduledTasks: Array<{ stop: FnMock }>;
	onChangeHandlers: Map<string, () => void>;
	listenMock: FnMock;
	closeServerMock: FnMock;
	initPubSubMock: FnMock;
	configInitMock: FnMock;
	appConfigOnChangeMock: FnMock;
	logOpenBrokerOrderWarningMock: FnMock;
	disconnectAllMock: FnMock;
	terminateAllMock: FnMock;
	closePubSubMock: FnMock;
	closeQueueEventsListenerMock: FnMock;
	storageCloseMock: FnMock;
	socialStoreCloseMock: FnMock;
};

async function loadLifecycleWithMocks(): Promise<{ lifecycle: LifecycleModule; mocks: MockContext }> {
	const scheduledTasks: Array<{ stop: jest.Mock }> = [];
	const onChangeHandlers = new Map<string, () => void>();
	const scheduleMock = jest.fn((_expr: string, _handler: () => void) => {
		const task = { stop: jest.fn() };
		scheduledTasks.push(task);
		return task;
	});

	const closeServerMock = jest.fn((callback?: () => void) => {
		if (callback) callback();
	});

	const listenMock = jest.fn((_port: number | string, callback?: () => void) => {
		if (callback) callback();
		return { close: closeServerMock };
	});

	const initPubSubMock = jest.fn(async () => undefined);
	const configInitMock = jest.fn(async () => undefined);
	const appConfigOnChangeMock = jest.fn((key: string, handler: () => void) => {
		onChangeHandlers.set(key, handler);
	});
	const logOpenBrokerOrderWarningMock = jest.fn();
	const runSentimentCronJobMock = jest.fn(async () => undefined);
	const runTrendingCronJobMock = jest.fn(async () => undefined);
	const runSocialCronJobMock = jest.fn(async () => undefined);
	const runMidnightResetJobMock = jest.fn();
	const disconnectAllMock = jest.fn(async () => undefined);
	const terminateAllMock = jest.fn(async () => undefined);
	const closePubSubMock = jest.fn(async () => undefined);
	const closeQueueEventsListenerMock = jest.fn(async () => undefined);
	const storageCloseMock = jest.fn();
	const socialStoreCloseMock = jest.fn();
	const loggerInfoMock = jest.fn();

	jest.doMock('node-cron', () => ({
		__esModule: true,
		default: { schedule: scheduleMock },
	}));

	jest.doMock('../../app.js', () => ({
		__esModule: true,
		default: { listen: listenMock },
		port: 3000,
		logOpenBrokerOrderWarning: logOpenBrokerOrderWarningMock,
		runSentimentCronJob: runSentimentCronJobMock,
		runTrendingCronJob: runTrendingCronJobMock,
		runSocialCronJob: runSocialCronJobMock,
		runMidnightResetJob: runMidnightResetJobMock,
	}));

	jest.doMock('../../services/pubsub.js', () => ({
		initPubSub: initPubSubMock,
		closePubSub: closePubSubMock,
	}));

	jest.doMock('../../services/config-service.js', () => ({
		configService: { init: configInitMock },
	}));

	jest.doMock('../../services/app-config-service.js', () => ({
		appConfigService: {
			get: (key: string) => {
				if (key === 'SENTIMENT_JOB_CRON') return '*/5 * * * *';
				if (key === 'TRENDING_JOB_CRON') return '*/10 * * * *';
				if (key === 'SOCIAL_SCRAPE_CRON') return '*/15 * * * *';
				return undefined;
			},
			onChange: appConfigOnChangeMock,
		},
	}));

	jest.doMock('../../services/worker-pool.js', () => ({
		workerPool: { terminateAll: terminateAllMock },
	}));

	jest.doMock('../../storage.js', () => ({
		storage: { close: storageCloseMock, isHealthy: jest.fn().mockReturnValue(false), getDb: jest.fn() },
	}));

	jest.doMock('../../services/tournament-scheduler.js', () => ({
		tournamentScheduler: { start: jest.fn(), stop: jest.fn() },
	}));

	jest.doMock('../../database/sqlite-social-store.js', () => ({
		socialStore: { close: socialStoreCloseMock },
	}));

	jest.doMock('../../routes/marl-competition.js', () => ({
		closeQueueEventsListener: closeQueueEventsListenerMock,
	}));

	jest.doMock('../../services/brokers/broker-registry.js', () => ({
		brokerRegistry: { disconnectAll: disconnectAllMock },
	}));

	jest.doMock('../../logger.js', () => ({
		__esModule: true,
		default: { info: loggerInfoMock },
	}));

	const lifecycle = await import('../../lifecycle.js');

	return {
		lifecycle,
		mocks: {
			scheduleMock,
			scheduledTasks,
			onChangeHandlers,
			listenMock,
			closeServerMock,
			initPubSubMock,
			configInitMock,
			appConfigOnChangeMock,
			logOpenBrokerOrderWarningMock,
			disconnectAllMock,
			terminateAllMock,
			closePubSubMock,
			closeQueueEventsListenerMock,
			storageCloseMock,
			socialStoreCloseMock,
		},
	};
}

describe('lifecycle runtime idempotency', () => {
	beforeEach(() => {
		jest.resetModules();
		jest.clearAllMocks();
	});

	it('startRuntime called twice only initializes runtime once', async () => {
		const { lifecycle, mocks } = await loadLifecycleWithMocks();

		lifecycle.startRuntime();
		lifecycle.startRuntime();

		expect(mocks.listenMock).toHaveBeenCalledTimes(1);
		expect(mocks.scheduleMock).toHaveBeenCalledTimes(4);
		expect(mocks.initPubSubMock).toHaveBeenCalledTimes(1);
		expect(mocks.configInitMock).toHaveBeenCalledTimes(1);
		expect(mocks.logOpenBrokerOrderWarningMock).toHaveBeenCalledTimes(1);
	});

	it('shutdownRuntime called twice performs cleanup once', async () => {
		const { lifecycle, mocks } = await loadLifecycleWithMocks();

		lifecycle.startRuntime();
		await lifecycle.shutdownRuntime();
		await lifecycle.shutdownRuntime();

		expect(mocks.closeServerMock).toHaveBeenCalledTimes(1);
		expect(mocks.scheduledTasks).toHaveLength(4);
		for (const task of mocks.scheduledTasks) {
			expect(task.stop).toHaveBeenCalledTimes(1);
		}

		expect(mocks.disconnectAllMock).toHaveBeenCalledTimes(1);
		expect(mocks.terminateAllMock).toHaveBeenCalledTimes(1);
		expect(mocks.closePubSubMock).toHaveBeenCalledTimes(1);
		expect(mocks.closeQueueEventsListenerMock).toHaveBeenCalledTimes(1);
		expect(mocks.storageCloseMock).toHaveBeenCalledTimes(1);
		expect(mocks.socialStoreCloseMock).toHaveBeenCalledTimes(1);
	});

	it('reschedules cron jobs when app-config cron key changes', async () => {
		const { lifecycle, mocks } = await loadLifecycleWithMocks();

		lifecycle.startRuntime();
		expect(mocks.scheduleMock).toHaveBeenCalledTimes(4);
		expect(mocks.appConfigOnChangeMock).toHaveBeenCalledTimes(3);

		const previousTasks = [...mocks.scheduledTasks];
		const sentimentChange = mocks.onChangeHandlers.get('SENTIMENT_JOB_CRON');
		expect(sentimentChange).toBeDefined();

		sentimentChange?.();

		expect(mocks.scheduleMock).toHaveBeenCalledTimes(8);
		for (const task of previousTasks) {
			expect(task.stop).toHaveBeenCalledTimes(1);
		}
	});
});
