import { defineCollection, z } from 'astro:content';

const optionalDate = z.preprocess((value) => {
  if (value === '' || value === null) return undefined;
  return value;
}, z.coerce.date().optional());

const areas = defineCollection({
  type: 'content',
  schema: z.object({
    name: z.string(),
    seoTitle: z.string().max(70),
    seoDescription: z.string().max(170),
    intro: z.string().min(80),
    image: z.string().optional(),
    order: z.number().default(100),
    indexable: z.boolean().default(true),
  }),
});

const categories = defineCollection({
  type: 'content',
  schema: z.object({
    name: z.string(),
    labelKo: z.string(),
    seoTitle: z.string().max(70),
    seoDescription: z.string().max(170),
    intro: z.string().min(80),
    image: z.string().optional(),
    order: z.number().default(100),
    indexable: z.boolean().default(true),
  }),
});

const home = defineCollection({
  type: 'content',
  schema: z.object({
    heroKicker: z.string().min(3).max(80),
    heroTitle: z.string().min(10).max(150),
    heroDescription: z.string().min(40).max(500),
    heroDescriptionImage: z.string().optional(),
    heroDescriptionImageAlt: z.string().max(140).optional(),
    categoryHighlights: z.array(z.object({
      category: z.string(),
      venueSlug: z.string(),
    })).default([]),
    seoBlockTitle: z.string().min(10).max(120).optional(),
    seoBlockParagraph1: z.string().min(40).max(600).optional(),
    seoBlockParagraph2: z.string().min(40).max(600).optional(),
    faqItems: z.array(z.object({
      question: z.string().min(4).max(140),
      answer: z.string().min(10).max(400),
    })).default([]),
    areaSectionTitle: z.string().min(2).max(80).optional(),
    areaSectionDescription: z.string().max(240).optional(),
    areaSectionCollapsed: z.boolean().default(true),
    areaExplorerAreas: z.array(z.object({
      area: z.string(),
      venueSlugs: z.array(z.string()).default([]),
    })).default([]),
  }),
});

const venues = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    area: z.string(),
    category: z.string(),
    shortDescription: z.string(),
    introBody: z.string().optional(),
    seoTitle: z.string(),
    seoDescription: z.string(),
    thumbnail: z.string(),
    thumbnailAlt: z.string(),
    thumbnailPosition: z.enum(['top', 'center', 'bottom']).default('center'),
    gallery: z.array(z.object({ image: z.string(), alt: z.string() })).default([]),
    usageSteps: z.array(z.object({
      title: z.string(),
      detail: z.string(),
    })).default([]),
    addressText: z.string().optional(),
    googleMapUrl: z.string().optional(),
    latitude: z.union([z.number(), z.string()]).optional(),
    longitude: z.union([z.number(), z.string()]).optional(),
    openingHours: z.string().optional(),
    priceRange: z.string().optional(),
    kakaoUrl: z.string().optional(),
    lineUrl: z.string().optional(),
    featured: z.boolean().default(false),
    visible: z.boolean().default(true),
    order: z.number().default(100),
    updatedAt: z.coerce.date(),
  }),
});

const banners = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    position: z.enum(['home_hero', 'home_top', 'home_middle', 'area_top', 'category_top', 'venue_top', 'venue_bottom']),
    image: z.string(),
    imageAlt: z.string().trim().min(1),
    linkUrl: z.string().optional().default('#'),
    description: z.string().max(120).optional(),
    buttonText: z.string().max(24).optional(),
    visible: z.boolean().default(true),
    order: z.number().default(100),
    startDate: optionalDate,
    endDate: optionalDate,
  }),
});

export const collections = { areas, categories, home, venues, banners };
