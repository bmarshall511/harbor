import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Providers } from '@/components/providers';
import { Toaster } from 'sonner';

const inter = Inter({ subsets: ['latin'], variable: '--font-sans' });

export const metadata: Metadata = {
  title: 'Harbor',
  description: 'Open-source archive and media intelligence',
  // Block crawlers by default — overridden by the dynamic robots.txt
  // route when the admin enables seo.allowCrawlers in Settings.
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} font-sans antialiased`}>
        <a href="#main-content" className="skip-to-content">
          Skip to content
        </a>
        <Providers>
          {children}
          <Toaster
            position="bottom-right"
            toastOptions={{
              className: 'bg-card text-card-foreground border border-border',
            }}
          />
        </Providers>
      </body>
    </html>
  );
}
