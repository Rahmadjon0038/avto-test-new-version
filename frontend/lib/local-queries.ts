// IndexedDB'dagi mahalliy nusxani o'qish ham TanStack Query orqali ishlaydi: natija keshlanadi
// (bank har sahifada qaytadan qurilmaydi), sahifalar orasida bo'lishiladi va sinxronlash tugagach
// bitta `["local"]` kaliti bilan yangilanadi (content-sync.ts).
//
// networkMode: "always" — bular tarmoqqa bog'liq emas, oflayn rejimda ham to'xtab qolmasligi kerak.
import { queryOptions } from "@tanstack/react-query";
import { getLocalAnswerBank, getLocalGeneratedCustomTestList } from "./answer-bank";
import { getCachedCustomTest, getCachedTicket, getCachedTopic } from "./content-db";

export const LOCAL_QUERY_ROOT = ["local"] as const;

const localDefaults = {
  staleTime: Infinity,
  gcTime: 30 * 60 * 1000,
  networkMode: "always" as const,
  retry: false
};

export const answerBankQuery = () =>
  queryOptions({
    queryKey: [...LOCAL_QUERY_ROOT, "answer-bank"],
    queryFn: getLocalAnswerBank,
    ...localDefaults
  });

export const generatedCustomTestsQuery = () =>
  queryOptions({
    queryKey: [...LOCAL_QUERY_ROOT, "generated-custom-tests"],
    queryFn: getLocalGeneratedCustomTestList,
    ...localDefaults
  });

export const localTicketQuery = (ticketId: string) =>
  queryOptions({
    queryKey: [...LOCAL_QUERY_ROOT, "ticket", ticketId],
    queryFn: async () => (await getCachedTicket(ticketId)) ?? null,
    ...localDefaults
  });

export const localTopicQuery = (topicId: string) =>
  queryOptions({
    queryKey: [...LOCAL_QUERY_ROOT, "topic", topicId],
    queryFn: async () => (await getCachedTopic(topicId)) ?? null,
    ...localDefaults
  });

export const localCustomTestQuery = (testId: string) =>
  queryOptions({
    queryKey: [...LOCAL_QUERY_ROOT, "custom-test", testId],
    queryFn: async () => (await getCachedCustomTest(testId)) ?? null,
    ...localDefaults
  });
