import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://scottschreckengaust.github.io',
  base: '/framework-for-github-app-on-aws',
  integrations: [
    starlight({
      title: 'Framework for GitHub Apps on AWS',
      description:
        'A serverless bot platform that receives GitHub webhook events, authenticates users via OAuth, and orchestrates workflows via Step Functions.',
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/scottschreckengaust/framework-for-github-app-on-aws',
        },
      ],
      sidebar: [
        {
          label: 'Getting Started',
          items: [
            { slug: 'quick-start' },
          ],
        },
        {
          label: 'Runbooks',
          autogenerate: { directory: 'runbooks' },
        },
        {
          label: 'Architecture Decisions',
          autogenerate: { directory: 'adr' },
        },
        {
          label: 'Reference',
          items: [
            { slug: 'architecture' },
            { slug: 'deployment-plan' },
          ],
        },
      ],
      editLink: {
        baseUrl:
          'https://github.com/scottschreckengaust/framework-for-github-app-on-aws/edit/main/docs/',
      },
      lastUpdated: true,
    }),
  ],
});
