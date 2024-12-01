const { logger, handleError } = require("../utils/helpers");
const config = require("../../config");
const TwitterService = require("./twitter");
const GithubService = require("./github");
const axios = require("axios");
const cron = require("node-cron");

const MAX_RETRIES = 3;
const RETRY_DELAY = 5000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const runDataPipeline = async (retryCount = 0) => {
  const stats = {
    startTime: new Date(),
    endTime: null,
    threadsProcessed: 0,
    linksFound: 0,
    markdownGenerated: false,
    errors: [],
  };

  try {
    logger.info(`Starting data pipeline at ${stats.startTime.toISOString()}`);

    const tweets = await TwitterService.fetchTweets();
    if (!tweets || !Array.isArray(tweets)) {
      throw new Error("No valid tweets returned from Twitter service");
    }

    stats.threadsProcessed = tweets.length;
    logger.info(`Fetched ${tweets.length} tweets`);

    if (tweets.length > 0) {
      const result = await GithubService.createMarkdownFileFromTweets(tweets);
      if (!result?.success) {
        throw new Error("Failed to create and upload markdown file");
      }

      stats.markdownGenerated = true;
      logger.info("Successfully created and uploaded markdown file", {
        url: result.url,
        sha: result.sha,
      });
    }

    stats.linksFound = tweets.reduce((total, thread) => {
      if (thread?.tweets) {
        return (
          total +
          thread.tweets.reduce(
            (threadTotal, tweet) => threadTotal + (tweet.links?.length || 0),
            0
          )
        );
      }
      return total;
    }, 0);

    stats.endTime = new Date();
    return stats;
  } catch (error) {
    handleError(
      error,
      `Pipeline error (attempt ${retryCount + 1}/${MAX_RETRIES})`,
      {
        retryCount,
        stats,
      }
    );

    if (retryCount < MAX_RETRIES) {
      logger.info(`Retrying in ${RETRY_DELAY}ms...`);
      await sleep(RETRY_DELAY * (retryCount + 1));
      return runDataPipeline(retryCount + 1);
    }

    throw error;
  }
};

async function sendDiscordNotification({
  success,
  stats = {},
  error = null,
  timestamp,
  retryCount = 0,
  githubUrl = null,
  message = null,
}) {
  if (!config.discord?.webhookUrl) {
    logger.warn("Discord notification skipped - webhook URL not configured");
    return;
  }

  try {
    const embed = {
      title: `Pipeline ${success ? "Success" : "Error"}`,
      color: success ? 0x00ff00 : 0xff0000,
      timestamp: new Date().toISOString(),
      fields: [
        {
          name: "Status",
          value: success ? "✅ Completed Successfully" : "❌ Failed",
          inline: true,
        },
        {
          name: "Timestamp",
          value: timestamp,
          inline: true,
        },
      ],
      footer: {
        text: `Twitter to GitHub Pipeline | ${new Date().toLocaleDateString()}`,
      },
    };

    if (success) {
      if (message) {
        embed.description = message;
      } else {
        embed.fields.push(
          {
            name: "Threads Processed",
            value: `${stats.threadsProcessed || 0}`,
            inline: true,
          },
          {
            name: "Links Found",
            value: `${stats.linksFound || 0}`,
            inline: true,
          },
          {
            name: "Markdown Generated",
            value: `${stats.markdownGenerated || false}`,
            inline: true,
          }
        );

        if (githubUrl) {
          embed.fields.push({
            name: "GitHub URL",
            value: githubUrl,
            inline: false,
          });
        }
      }
    } else {
      embed.fields.push(
        {
          name: "Error Details",
          value: `\`\`\`\n${error}\n\`\`\``,
          inline: false,
        },
        {
          name: "Pipeline Progress",
          value: Object.entries(stats)
            .map(([key, value]) => `${key}: ${value}`)
            .join("\n"),
          inline: false,
        },
        {
          name: "Retry Count",
          value: `${retryCount}/${MAX_RETRIES}`,
          inline: true,
        }
      );
    }

    await axios.post(config.discord.webhookUrl, { embeds: [embed] });
    logger.info("Sent Discord notification");
  } catch (webhookError) {
    handleError(webhookError, "Failed to send Discord notification", {
      success,
      webhookError: webhookError.message,
    });
  }
}

const initCronJob = () => {
  const schedule = config.cron?.schedule || "0 * * * *";

  try {
    if (!cron.validate(schedule)) {
      throw new Error(`Invalid cron schedule: ${schedule}`);
    }

    const job = cron.schedule(schedule, async () => {
      const startTime = Date.now();
      logger.info(`Running scheduled pipeline at ${new Date().toISOString()}`);

      try {
        const stats = await runDataPipeline();
        const duration = Date.now() - startTime;
        logger.info(`Pipeline completed in ${duration}ms`, { stats });
      } catch (error) {
        logger.error("Scheduled pipeline failed:", error);
      }
    });

    logger.info(`Cron job initialized with schedule: ${schedule}`);
    return job;
  } catch (error) {
    logger.error("Failed to initialize cron job:", error);
    throw error;
  }
};

module.exports = {
  runDataPipeline,
  initCronJob,
  sendDiscordNotification,
};
