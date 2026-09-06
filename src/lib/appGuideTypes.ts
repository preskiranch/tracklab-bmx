export type AppGuideArticle = {
  title: string;
  paragraphs: string[];
  steps?: string[];
  bullets?: string[];
};

export type AppGuideSection = {
  id: string;
  title: string;
  summary: string;
  articles: AppGuideArticle[];
};
