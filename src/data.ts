export type Stay = {
  id: string
  title: string
  location: string
  region: string
  price: number
  rating: number
  reviews: number
  category: string
  image: string
  hostId: string
  hostAvatarUrl: string
  host: string
  badge?: string
  airbnbUrl?: string
  description: string
  amenities: string[]
}

export const photoUrl = (image: string, width = 900) => {
  if (image.startsWith('https://images.unsplash.com/')) {
    const url = new URL(image)
    url.searchParams.set('auto', 'format')
    url.searchParams.set('fit', 'crop')
    url.searchParams.set('w', String(width))
    url.searchParams.set('q', '85')
    return url.toString()
  }
  if (image.startsWith('http://') || image.startsWith('https://')) return image
  return `https://images.unsplash.com/${image}?auto=format&fit=crop&w=${width}&q=85`
}
