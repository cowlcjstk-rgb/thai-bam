import { defineCollection, z } from 'astro:content';

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

const venues = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    area: z.string(),
    category: z.string(),
    shortDescription: z.string().min(40).max(180),
    introBody: z.string().min(80).optional(),
    seoTitle: z.string().max(70),
    seoDescription: z.string().max(170),
    thumbnail: z.string(),
    thumbnailAlt: z.string().min(10),
    gallery: z.array(z.object({ image: z.string(), alt: z.string() })).default([]),
    usageSteps: z.array(z.object({
      title: z.string(),
      detail: z.string(),
    })).default([]),
    addressText: z.string().optional(),
    latitude: z.number().optional(),
    longitude: z.number().optional(),
    openingHours: z.string().optional(),
    priceRange: z.string().optional(),
    kakaoUrl: z.string().url().optional(),
    lineUrl: z.string().url().optional(),
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
    position: z.enum(['home_top', 'home_middle', 'area_top', 'category_top', 'venue_top', 'venue_bottom']),
    image: z.string(),
    imageAlt: z.string().min(10),
    linkUrl: z.string().optional().default('#'),
    description: z.string().max(120).optional(),
    buttonText: z.string().max(24).optional(),
    visible: z.boolean().default(true),
    order: z.number().default(100),
    startDate: z.coerce.date().optional(),
    endDate: z.coerce.date().optional(),
  }),
});

export const collections = { areas, categories, venues, banners };
