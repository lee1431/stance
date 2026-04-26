// 1. 음악 데이터 (실제로는 fetch('./music_list.json')으로 가져올 수 있습니다)
const musicData = [
    { title: "첫 번째 음악", artist: "STANCE", file: "./music/track1.mp3" },
    { title: "두 번째 음악", artist: "Unknown", file: "./music/track2.mp3" }
];

const musicList = document.getElementById('music-list');
const audio = document.getElementById('main-audio');
const currentTitle = document.getElementById('current-title');
const currentArtist = document.getElementById('current-artist');

// 2. 목록 렌더링 함수
function renderList(data) {
    musicList.innerHTML = data.map((song, index) => `
        <li class="music-item">
            <div class="music-info" onclick="playMusic('${song.file}', '${song.title}', '${song.artist}')">
                <strong>${song.title}</strong>
                <div style="font-size: 0.8rem; color: #94a3b8;">${song.artist}</div>
            </div>
            <a href="${song.file}" download="${song.title}.mp3" class="btn-download">다운로드</a>
        </li>
    `).join('');
}

// 3. 재생 함수
function playMusic(file, title, artist) {
    audio.src = file;
    currentTitle.innerText = title;
    currentArtist.innerText = artist;
    audio.play();
}

// 초기화
document.addEventListener('DOMContentLoaded', () => {
    renderList(musicData);
});
