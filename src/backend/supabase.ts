// Supabase backend. Uses only the public anon key; every privileged rule is enforced by the
// SQL functions in supabase/migrations (RLS + SECURITY DEFINER), never by this file.
import { createClient } from '@supabase/supabase-js'
import type { Backend, CloudSave, CloudWrite, CommunityResident, Entry, GuildMember, RecruitEvent, Registration } from './types'

type Row = Record<string, unknown>
const toRegistration = (r: Row): Registration => ({
  id: r.id as string, instagram: r.instagram as string, displayName: r.display_name as string, personality: r.personality as Registration['personality'],
  appearance: r.appearance as Registration['appearance'], status: r.status as Registration['status'], verificationCode: r.verification_code as string,
  source: (r.source as Registration['source']) ?? 'self', showInstagram: !!r.consent_show_instagram, reviewNote: (r.review_note as string) ?? null, createdAt: r.created_at as string,
  follows: (r.follows as boolean | null) ?? null,
})
const toResident = (r: Row): CommunityResident => ({
  id: r.id as string, displayName: r.display_name as string, instagram: (r.instagram as string) ?? null, personality: r.personality as CommunityResident['personality'],
  appearance: r.appearance as CommunityResident['appearance'], homeBuildingId: (r.home_building_id as string) ?? null, createdAt: r.created_at as string,
})

export function createSupabaseBackend(url: string, anonKey: string): Backend {
  const sb = createClient(url, anonKey, { auth: { persistSession: true, autoRefreshToken: true } })
  const rpc = async <T,>(fn: string, args?: Row) => {
    const { data, error } = await sb.rpc(fn, args)
    if (error) throw new Error(error.message)
    return data as T
  }
  /** Followers register with an anonymous Supabase account, so they can check status or withdraw later. */
  const ensureSession = async () => {
    const { data } = await sb.auth.getSession()
    if (data.session) return
    const { error } = await sb.auth.signInAnonymously()
    if (error) throw new Error(`Could not start a session: ${error.message}`)
  }

  return {
    mode: 'supabase',
    async register(i) {
      await ensureSession()
      const rows = await rpc<Row[]>('register_resident', {
        p_instagram: i.instagram, p_display_name: i.displayName, p_personality: i.personality, p_appearance: i.appearance,
        p_consent_data: i.consentData, p_show_instagram: i.showInstagram,
      })
      const r = rows[0]
      return { id: r.id as string, verificationCode: r.verification_code as string, status: r.status as Registration['status'] }
    },
    async myRegistration() {
      const { data } = await sb.auth.getSession()
      if (!data.session) return null
      const rows = await rpc<Row[]>('my_registration')
      return rows[0] ? toRegistration(rows[0]) : null
    },
    async withdraw() { await rpc('withdraw_my_registration') },
    async listResidents() { return (await rpc<Row[]>('list_residents')).map(toResident) },
    async isFollower(instagram) { return rpc<boolean | null>('is_follower', { p_instagram: instagram }) },
    async followerListInfo() {
      const rows = await rpc<Row[]>('follower_list_info')
      return rows[0] ? { uploadedAt: rows[0].uploaded_at as string, count: rows[0].follower_count as number } : null
    },
    async setFollowers(hashes) { return rpc<number>('admin_set_followers', { p_hashes: hashes }) },
    async listGuildMembers() {
      return (await rpc<Row[]>('list_guild_members')).map((r): GuildMember => ({
        id: r.id as string, residentId: r.resident_id as string, displayName: r.display_name as string, rank: r.rank as number,
        rankName: r.rank_name as string, cls: r.class as GuildMember['cls'], renown: r.renown as number, joinedAt: r.joined_at as string,
      }))
    },
    async listEvents() {
      return (await rpc<Row[]>('list_recruitment_events')).map((r): RecruitEvent => ({
        id: r.id as string, title: r.title as string, postUrl: r.post_url as string, startsAt: r.starts_at as string, endsAt: r.ends_at as string,
        minComments: r.min_comments as number, minChars: r.min_chars as number, maxPerDay: r.max_per_day as number, slots: r.slots as number,
        status: r.status as RecruitEvent['status'], createdAt: r.created_at as string,
      }))
    },
    async leaderboard(eventId) {
      return (await rpc<Row[]>('list_leaderboard', { p_event: eventId })).map((r): Entry => ({
        place: r.place as number, instagram: r.instagram as string, totalComments: r.total_comments as number, validComments: r.valid_comments as number,
        eligible: r.eligible as boolean, reason: (r.reason as string) ?? null, status: r.status as Entry['status'],
      }))
    },
    async createEvent(e) {
      return rpc<string>('admin_create_event', { p_title: e.title, p_post_url: e.postUrl, p_starts_at: e.startsAt, p_ends_at: e.endsAt,
        p_min_comments: e.minComments, p_slots: e.slots, p_min_chars: e.minChars, p_max_per_day: e.maxPerDay })
    },
    async importComments(eventId, rows) { return rpc('admin_import_comments', { p_event: eventId, p_rows: rows }) },
    async reviewEntry(eventId, instagram, approve, cls) { await rpc('admin_review_entry', { p_event: eventId, p_instagram: instagram, p_approve: approve, p_class: cls }) },
    async closeEvent(eventId) { await rpc('admin_close_event', { p_event: eventId }) },
    async updateMember(id, rank, cls) { await rpc('admin_update_member', { p_member: id, p_rank: rank, p_class: cls }) },
    async addRenown(id, amount, reason) { return rpc<number>('admin_add_renown', { p_member: id, p_amount: amount, p_reason: reason }) },
    async removeMember(id) { await rpc('admin_remove_member', { p_member: id }) },
    cloudLoad: () => rpc<CloudSave | null>('cloud_save_load'),
    cloudSave: (data, summary, device, baseRev) => rpc<CloudWrite>('cloud_save_write', { p_data: data, p_summary: summary, p_device: device, p_base_rev: baseRev }),
    async session() {
      const { data } = await sb.auth.getSession()
      const user = data.session?.user
      if (!user || user.is_anonymous) return { signedIn: false, email: null, isGuildMaster: false }
      return { signedIn: true, email: user.email ?? null, isGuildMaster: await rpc<boolean>('is_guild_master') }
    },
    async signIn(email) {
      const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname, shouldCreateUser: true } })
      if (error) throw new Error(error.message)
    },
    async signOut() { await sb.auth.signOut() },
    async listRegistrations(status) { return (await rpc<Row[]>('admin_list_registrations', { p_status: status })).map(toRegistration) },
    async review(id, approve, note) { await rpc('admin_review_registration', { p_id: id, p_approve: approve, p_note: note ?? null }) },
    async addResident(i) {
      return rpc<string>('admin_add_resident', {
        p_instagram: i.instagram, p_display_name: i.displayName, p_personality: i.personality, p_appearance: i.appearance,
        p_consent_data: i.consentData, p_show_instagram: i.showInstagram, p_source: 'admin',
      })
    },
    async importResidents(rows) { return rpc('admin_import_residents', { p_rows: rows }) },
    async removeResident(id) { await rpc('admin_remove_resident', { p_id: id }) },
    async setHome(id, home) { await rpc('admin_set_home', { p_id: id, p_home: home }) },
  }
}
