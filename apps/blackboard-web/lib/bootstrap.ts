import { ChangeBus } from "./change-bus";
import { CommentsStore } from "./comments-store";
import { Db } from "./db/client";
import { Migrations } from "./db/migrate";
import { AgentsRepo } from "./db/repos/agents";
import { CommentsRepo } from "./db/repos/comments";
import { ContentBlocksRepo } from "./db/repos/content-blocks";
import { DocumentsRepo } from "./db/repos/documents";
import { ReadingStateRepo } from "./db/repos/reading-state";
import { Lock } from "./lock";
import { ReadingStateStore } from "./reading-state";
import { SessionsStore } from "./sessions";

/**
 * Every dependency the API and the CLI build, constructed once, in one place, in dependency order.
 *
 * Nothing here is a container: `new X(dep)` is the whole wiring, and a class that needs something new
 * takes it as a constructor argument in this file. The routes never reach for a global — they are
 * handed what they use, so a test can build the same graph against a temp home.
 */
export type Services = ReturnType<typeof bootstrap>;

export function bootstrap() {
  const lock = new Lock();
  const bus = new ChangeBus();

  const db = new Db();
  const agents = new AgentsRepo(db);
  const documents = new DocumentsRepo(db);
  const commentsRepo = new CommentsRepo(db);
  const contentBlocks = new ContentBlocksRepo(db);
  const readingRepo = new ReadingStateRepo(db);

  const comments = new CommentsStore(commentsRepo, contentBlocks, bus);
  const sessions = new SessionsStore(db, documents, comments);
  const reading = new ReadingStateStore(readingRepo);
  const migrations = new Migrations(db, lock);

  return {
    lock,
    bus,
    db,
    agents,
    documents,
    commentsRepo,
    contentBlocks,
    readingRepo,
    comments,
    sessions,
    reading,
    migrations,
  };
}
