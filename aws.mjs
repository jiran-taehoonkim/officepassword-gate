import { CloudWatchLogsClient, FilterLogEventsCommand, DescribeLogGroupsCommand } from "@aws-sdk/client-cloudwatch-logs";

const mk = (awsId, awsSecret, region) =>
  new CloudWatchLogsClient({ region, credentials: { accessKeyId: awsId, secretAccessKey: awsSecret } });

// 최근 N분 로그 이벤트
export async function recentLogs({ awsId, awsSecret, region, logGroup, minutes = 10, limit = 300 }) {
  const client = mk(awsId, awsSecret, region);
  const startTime = Date.now() - minutes * 60 * 1000;
  const out = await client.send(new FilterLogEventsCommand({ logGroupName: logGroup, startTime, limit }));
  return (out.events || []).map((e) => ({ ts: new Date(e.timestamp).toISOString(), stream: e.logStreamName, msg: (e.message || "").trim() }));
}

// 로그그룹 탐색 (이름 모를 때 AI가 찾도록)
export async function listLogGroups({ awsId, awsSecret, region, prefix }) {
  const client = mk(awsId, awsSecret, region);
  const out = await client.send(new DescribeLogGroupsCommand(prefix ? { logGroupNamePrefix: prefix, limit: 30 } : { limit: 30 }));
  return (out.logGroups || []).map((g) => g.logGroupName);
}
